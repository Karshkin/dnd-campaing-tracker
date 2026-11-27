-- The Storage API does not need to forward the selected-campaign header.
-- Each object path resolves to its actual campaign via globally unique entry IDs.
-- Retain this mapping after a row is deleted so its files can still be removed.
create table campaign_private.asset_parents (
  relation_name text not null,
  entry_id integer not null,
  campaign_id uuid not null references public.campaigns on delete cascade,
  owner_id uuid,
  primary key (relation_name,entry_id)
);
revoke all on campaign_private.asset_parents from public, anon, authenticated;

create function campaign_private.remember_asset_parent() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
  values (tg_table_name,new.id,new.campaign_id,(to_jsonb(new) ->> 'user_id')::uuid);
  return new;
end;
$$;
revoke all on function campaign_private.remember_asset_parent() from public, anon, authenticated;

insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
select 'maps',id,campaign_id,null from public.maps;
create trigger remember_asset_parent after insert on public.maps
for each row execute function campaign_private.remember_asset_parent();
insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
select 'map_events',id,campaign_id,null from public.map_events;
create trigger remember_asset_parent after insert on public.map_events
for each row execute function campaign_private.remember_asset_parent();
insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
select 'points_of_interest',id,campaign_id,null from public.points_of_interest;
create trigger remember_asset_parent after insert on public.points_of_interest
for each row execute function campaign_private.remember_asset_parent();
insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
select 'resources',id,campaign_id,null from public.resources;
create trigger remember_asset_parent after insert on public.resources
for each row execute function campaign_private.remember_asset_parent();
insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
select 'diary_entries',id,campaign_id,null from public.diary_entries;
create trigger remember_asset_parent after insert on public.diary_entries
for each row execute function campaign_private.remember_asset_parent();
insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
select 'organizations',id,campaign_id,null from public.organizations;
create trigger remember_asset_parent after insert on public.organizations
for each row execute function campaign_private.remember_asset_parent();
insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
select 'characters',id,campaign_id,user_id from public.characters;
create trigger remember_asset_parent after insert on public.characters
for each row execute function campaign_private.remember_asset_parent();
insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
select 'creatures',id,campaign_id,null from public.creatures;
create trigger remember_asset_parent after insert on public.creatures
for each row execute function campaign_private.remember_asset_parent();
insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
select 'allies',id,campaign_id,null from public.allies;
create trigger remember_asset_parent after insert on public.allies
for each row execute function campaign_private.remember_asset_parent();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('campaign-art','campaign-art',false,10485760,
  array['image/png','image/jpeg','image/webp','image/gif','image/avif','image/bmp','image/tiff']);

create function campaign_private.scoped_asset_access(bucket text, path text, operation text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  kind text := split_part(path,'/',1);
  pieces text[] := string_to_array(path,'/');
  row_id text;
  relation text;
  section text;
  campaign uuid;
  owner_id uuid;
  linked boolean := false;
  portrait boolean := false;
  live boolean := false;
  can_write boolean;
  can_read boolean;
  image_suffix text := '\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$';
begin
  if auth.uid() is null then return false; end if;
  if bucket = 'campaign-art' then
    if path !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/(cover|emblem)/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'
      then return false; end if;
    campaign := kind::uuid;
    select coalesce(cover_path = path,false) or coalesce(emblem_path = path,false)
    into linked from public.campaigns where id = campaign;
    can_write := campaign_private.is_campaign_director(campaign);
    return case operation
      when 'read' then can_write or (linked and campaign_private.is_campaign_member(campaign))
      when 'insert' then can_write
      when 'delete' then can_write and not linked
      else false end;
  end if;

  if bucket = 'campaign-files' then
    relation := kind;
    row_id := pieces[case when kind = 'characters' then 3 else 2 end];
    if relation not in ('maps','map_events','points_of_interest','resources','diary_entries','organizations','characters','creatures','allies')
      then return false; end if;
    if relation = 'characters' then
      if path !~ '^characters/[0-9a-f-]{36}/[1-9][0-9]{0,9}/[0-9a-f-]{36}\.(pdf|png|jpe?g|webp|gif|avif|bmp|tiff?)$' then return false; end if;
    elsif path !~ ('^' || relation || '/[1-9][0-9]{0,9}/[0-9a-f-]{36}' || image_suffix) then
      return false;
    end if;
  elsif bucket = 'character-gallery' then
    relation := 'characters';
    row_id := pieces[2];
    if path !~ ('^[0-9a-f-]{36}/[1-9][0-9]{0,9}/[0-9a-f-]{36}' || image_suffix) then return false; end if;
  elsif bucket = 'campaign-entry-images' then
    relation := case kind when 'bestiary' then 'creatures' when 'npcs' then 'allies' when 'organizations' then 'organizations' end;
    row_id := pieces[2];
    if relation is null or path !~ ('^' || kind || '/[1-9][0-9]{0,9}/[0-9a-f-]{36}' || image_suffix) then return false; end if;
  else
    return false;
  end if;

  if row_id::bigint > 2147483647 then return false; end if;
  select a.campaign_id,a.owner_id into campaign,owner_id
  from campaign_private.asset_parents a where a.relation_name = relation and a.entry_id = row_id::integer;
  if not found or not campaign_private.is_campaign_member(campaign) then return false; end if;

  section := case relation when 'characters' then 'characters' when 'creatures' then 'bestiary'
    when 'allies' then 'npcs' when 'organizations' then 'organizations' else 'tracker' end;
  if relation = 'characters' then
    if owner_id is null or owner_id::text <> pieces[case when bucket = 'character-gallery' then 1 else 2 end]
      then return false; end if;
  end if;

  if bucket = 'campaign-files' then
    if relation = 'characters' then
      select coalesce(c.image_path = path,false),
        coalesce(c.sheet_file_path = path,false) or coalesce(c.image_path = path,false)
      into portrait,linked from public.characters c where c.id = row_id::integer and c.campaign_id = campaign;
    elsif relation = 'maps' then
      select m.file_path = path into linked from public.maps m where m.id = row_id::integer and m.campaign_id = campaign;
    else
      execute format('select coalesce(image_path = $1,false) from public.%I where id = $2 and campaign_id = $3',relation)
        into linked using path,row_id::integer,campaign;
    end if;
  elsif bucket = 'character-gallery' then
    select exists(select 1 from public.character_gallery g where g.object_path = path and g.campaign_id = campaign) into linked;
  else
    select exists(select 1 from public.campaign_entry_images g where g.object_path = path and g.campaign_id = campaign) into linked;
  end if;
  linked := coalesce(linked,false);

  can_write := case when relation = 'maps' then campaign_private.permitted_in(campaign,'admin',3)
    when relation = 'characters' then owner_id = auth.uid() and campaign_private.permitted_in(campaign,section,2)
    else campaign_private.permitted_in(campaign,section,2) end;

  if operation = 'insert' then
    if not can_write then return false; end if;
    execute format('select exists(select 1 from public.%I where id = $1 and campaign_id = $2)',relation)
      into live using row_id::integer,campaign;
    return live;
  end if;
  if operation = 'delete' then return can_write and not linked; end if;
  if operation <> 'read' then return false; end if;
  if can_write and not linked then return true; end if;
  if not linked then return false; end if;
  if relation = 'characters' then
    return (owner_id = auth.uid() and campaign_private.permitted_in(campaign,'characters',1))
      or ((bucket = 'character-gallery' or portrait) and campaign_private.is_campaign_director(campaign));
  end if;
  if relation = 'maps' then
    select m.is_active into live from public.maps m where m.id = row_id::integer and m.campaign_id = campaign;
    return can_write or (live and campaign_private.permitted_in(campaign,'tracker',1));
  end if;
  return campaign_private.permitted_in(campaign,section,1);
end;
$$;
revoke all on function campaign_private.scoped_asset_access(text,text,text) from public, anon, authenticated;
grant execute on function campaign_private.scoped_asset_access(text,text,text) to authenticated;
drop policy campaign_files_read on storage.objects;
drop policy campaign_files_insert on storage.objects;
drop policy campaign_files_delete on storage.objects;
drop policy gallery_storage_read on storage.objects;
drop policy gallery_storage_insert on storage.objects;
drop policy gallery_storage_delete on storage.objects;
drop policy gallery_storage_global_admin_read on storage.objects;
drop policy character_portrait_global_admin_read on storage.objects;
drop policy campaign_entry_storage_read on storage.objects;
drop policy campaign_entry_storage_insert on storage.objects;
drop policy campaign_entry_storage_delete on storage.objects;

create policy scoped_campaign_asset_read on storage.objects for select to authenticated
using (campaign_private.scoped_asset_access(bucket_id,name,'read'));
create policy scoped_campaign_asset_insert on storage.objects for insert to authenticated
with check (campaign_private.scoped_asset_access(bucket_id,name,'insert'));
create policy scoped_campaign_asset_delete on storage.objects for delete to authenticated
using (campaign_private.scoped_asset_access(bucket_id,name,'delete'));
-- Restrictive guards also protect these buckets if another permissive Storage policy exists.
create policy guard_campaign_asset_read on storage.objects as restrictive for select to authenticated
using (bucket_id not in ('campaign-files','character-gallery','campaign-entry-images','campaign-art')
  or campaign_private.scoped_asset_access(bucket_id,name,'read'));
create policy guard_campaign_asset_insert on storage.objects as restrictive for insert to authenticated
with check (bucket_id not in ('campaign-files','character-gallery','campaign-entry-images','campaign-art')
  or campaign_private.scoped_asset_access(bucket_id,name,'insert'));
create policy guard_campaign_asset_delete on storage.objects as restrictive for delete to authenticated
using (bucket_id not in ('campaign-files','character-gallery','campaign-entry-images','campaign-art')
  or campaign_private.scoped_asset_access(bucket_id,name,'delete'));
create policy guard_campaign_asset_update on storage.objects as restrictive for update to authenticated
using (bucket_id not in ('campaign-files','character-gallery','campaign-entry-images','campaign-art'))
with check (bucket_id not in ('campaign-files','character-gallery','campaign-entry-images','campaign-art'));
