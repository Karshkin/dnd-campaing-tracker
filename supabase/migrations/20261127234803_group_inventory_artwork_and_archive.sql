alter table public.inventory_groups add column archived_at timestamptz;
alter table public.inventory_group_contributions add column artwork_path text;
alter table public.character_inventory add column artwork_path text;
create index group_inventory_artwork_idx on public.inventory_group_contributions(artwork_path) where artwork_path is not null;
create index character_inventory_artwork_idx on public.character_inventory(artwork_path) where artwork_path is not null;

create function campaign_private.require_active_inventory_group() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare archived timestamptz;
declare party integer := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
begin
  select g.archived_at into archived from public.inventory_groups g where g.id = party for share;
  if archived is not null then raise exception 'El grupo está archivado'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function campaign_private.require_active_inventory_group() from public,anon,authenticated;
create trigger active_group_members before insert on public.inventory_group_members
for each row execute function campaign_private.require_active_inventory_group();
create trigger active_group_contributions before insert or update of quantity, artwork_path or delete on public.inventory_group_contributions
for each row execute function campaign_private.require_active_inventory_group();
create trigger active_group_wallet before insert or update on public.treasury_wallet
for each row execute function campaign_private.require_active_inventory_group();

create function campaign_private.manage_inventory_group(action text, party integer, group_name text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare c uuid := campaign_private.selected_campaign();
declare archived timestamptz;
begin
  if auth.uid() is null or not campaign_private.is_campaign_director(c) then raise exception 'Se requiere permiso de director'; end if;
  perform pg_advisory_xact_lock(hashtextextended(c::text,22));
  select g.archived_at into strict archived from public.inventory_groups g
    where (g.campaign_id,g.id) = (c,party) for update;
  if action = 'impact' then
    return jsonb_build_object(
      'members',(select count(*) from public.inventory_group_members where group_id = party),
      'items',(select coalesce(sum(quantity),0) from public.inventory_group_contributions where group_id = party),
      'coins',(select coalesce(jsonb_object_agg(denomination,balance),'{}'::jsonb) from public.treasury_wallet where group_id = party),
      'history',(select count(*) from public.treasury_history where group_id = party));
  end if;
  if archived is not null then raise exception 'El grupo está archivado'; end if;
  if action = 'rename' then
    update public.inventory_groups set name = btrim(group_name) where id = party;
  elsif action = 'archive' then
    update public.inventory_groups set archived_at = clock_timestamp() where id = party;
  else
    raise exception 'Acción de grupo desconocida';
  end if;
  return null;
end;
$$;
revoke all on function campaign_private.manage_inventory_group(text,integer,text) from public,anon,authenticated;
grant execute on function campaign_private.manage_inventory_group(text,integer,text) to authenticated;
create function public.manage_inventory_group(action text, party integer, group_name text default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select campaign_private.manage_inventory_group(action,party,group_name); $$;
revoke all on function public.manage_inventory_group(text,integer,text) from public,anon,authenticated;
grant execute on function public.manage_inventory_group(text,integer,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('inventory-artwork','inventory-artwork',false,10485760,array['image/png','image/jpeg','image/webp','image/gif','image/avif']);

create function campaign_private.inventory_artwork_write(path text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.inventory_group_contributions i join public.inventory_groups g on g.id = i.group_id
    where g.archived_at is null and
      path ~ ('^' || i.campaign_id::text || '/' || i.id::text || '/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$')
      and (campaign_private.is_campaign_director(i.campaign_id) or (
        i.contributed_by = auth.uid() and campaign_private.permitted_in(i.campaign_id,'tracker',1)
        and exists(select 1 from public.inventory_group_members m where m.group_id = i.group_id and m.user_id = auth.uid())
      ))
  );
$$;
revoke all on function campaign_private.inventory_artwork_write(text) from public,anon,authenticated;
grant execute on function campaign_private.inventory_artwork_write(text) to authenticated;

create function campaign_private.inventory_artwork_read(path text) returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Storage requests have no campaign header. Derive scope from the referencing item.
  select auth.uid() is not null and (
    exists (select 1 from public.inventory_group_contributions i
      where i.artwork_path = path and (campaign_private.is_campaign_director(i.campaign_id) or (
        campaign_private.permitted_in(i.campaign_id,'tracker',1) and exists (
          select 1 from public.inventory_group_members m where m.group_id = i.group_id and m.user_id = auth.uid()
        )
      )))
    or exists (select 1 from public.character_inventory i join public.characters ch on ch.id = i.character_id
      where i.artwork_path = path and ch.user_id = auth.uid() and campaign_private.permitted_in(i.campaign_id,'characters',1))
  );
$$;
revoke all on function campaign_private.inventory_artwork_read(text) from public,anon,authenticated;
grant execute on function campaign_private.inventory_artwork_read(text) to authenticated;
create policy inventory_artwork_read on storage.objects for select to authenticated
using (bucket_id = 'inventory-artwork' and campaign_private.inventory_artwork_read(name));
create policy inventory_artwork_upload on storage.objects for insert to authenticated
with check (bucket_id = 'inventory-artwork' and campaign_private.inventory_artwork_write(name));
create policy guard_inventory_artwork_read on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'inventory-artwork' or campaign_private.inventory_artwork_read(name));
create policy guard_inventory_artwork_upload on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'inventory-artwork' or campaign_private.inventory_artwork_write(name));
create policy guard_inventory_artwork_update on storage.objects as restrictive for update to authenticated
using (bucket_id <> 'inventory-artwork') with check (bucket_id <> 'inventory-artwork');
create policy guard_inventory_artwork_delete on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'inventory-artwork');

create function campaign_private.set_inventory_artwork(item integer, path text, previous_path text) returns void
language plpgsql security definer set search_path = ''
as $$
declare c uuid := campaign_private.selected_campaign();
declare candidate text := coalesce(path,c::text || '/' || item::text || '/00000000-0000-0000-0000-000000000000.png');
begin
  perform pg_advisory_xact_lock(hashtextextended(c::text,22));
  if not campaign_private.inventory_artwork_write(candidate)
    or split_part(candidate,'/',2) <> item::text then raise exception 'Objeto no disponible'; end if;
  if path is not null and not exists(select 1 from storage.objects where bucket_id = 'inventory-artwork' and name = path)
    then raise exception 'Imagen no disponible'; end if;
  update public.inventory_group_contributions set artwork_path = path
  where campaign_id = c and id = item and artwork_path is not distinct from previous_path;
  if not found then raise exception 'La imagen ha cambiado. Recarga el inventario.'; end if;
end;
$$;
revoke all on function campaign_private.set_inventory_artwork(integer,text,text) from public,anon,authenticated;
grant execute on function campaign_private.set_inventory_artwork(integer,text,text) to authenticated;
create function public.set_inventory_artwork(item integer, path text, previous_path text) returns void
language sql security invoker set search_path = ''
as $$ select campaign_private.set_inventory_artwork(item,path,previous_path); $$;
revoke all on function public.set_inventory_artwork(integer,text,text) from public,anon,authenticated;
grant execute on function public.set_inventory_artwork(integer,text,text) to authenticated;

create or replace function campaign_private.move_treasure(c uuid, payload jsonb, session uuid) returns void
language plpgsql security invoker set search_path = ''
as $$
declare party integer := (payload->>'group_id')::integer;
declare target integer := (payload->>'character_id')::integer;
declare source_id integer := (payload->>'item_id')::integer;
declare amount integer := (payload->>'quantity')::integer;
declare action text := payload->>'operation';
declare coin public.coin_denomination := (payload->>'denomination')::public.coin_denomination;
declare details public.treasure_details;
declare artwork text;
declare stock integer;
declare legacy_description text;
declare label text;
declare owner_id uuid;
declare director boolean := campaign_private.is_campaign_director(c);
begin
  if not coalesce(campaign_private.treasury_group_access(c,party),false) then raise exception 'Group access required'; end if;
  if amount is null or amount not between 1 and 1000000000 then raise exception 'Invalid quantity'; end if;
  if action is null or action not in ('deposit','withdraw','consume','to_group','to_character','distribution') then
    raise exception 'Invalid treasury operation';
  end if;
  if session is not null and not exists(select 1 from public.chronicle_sessions s
    where (s.campaign_id,s.id) = (c,session) and (director or s.status in ('published','closed'))) then
    raise exception 'Session unavailable';
  end if;

  if action in ('to_group','to_character','distribution') then
    select ch.user_id into owner_id from public.characters ch where (ch.campaign_id,ch.id) = (c,target) for key share;
    if owner_id is null or (owner_id <> auth.uid() and not (director and action in ('distribution','to_character')
       and exists(select 1 from public.inventory_group_members m
         where (m.campaign_id,m.group_id,m.user_id) = (c,party,owner_id))))
       or (owner_id = auth.uid() and not campaign_private.permitted_in(c,'characters',2)) then
      raise exception 'Character access required';
    end if;
  else
    target := null;
  end if;

  if coin is not null then
    if action = 'to_group' then
      perform campaign_private.change_wallet(c,null,target,coin,-amount);
    end if;
    perform campaign_private.change_wallet(c,party,null,coin,case when action in ('deposit','to_group') then amount else -amount end);
    if action in ('distribution','to_character') then
      perform campaign_private.change_wallet(c,null,target,coin,amount);
    end if;
    label := coin::text;
  elsif action = 'distribution' then
    raise exception 'Choose a coin denomination';
  else
    if action = 'deposit' then
      label := btrim(payload->>'name');
      select * into details from jsonb_populate_record(null::public.treasure_details, payload->'details');
      if details.category is null or details.rarity is null or details.weight is null
         or details.value_gp is null or details.description is null or details.quest_item is null
         or details.unidentified is null then raise exception 'Incomplete item details'; end if;
    elsif action = 'to_group' then
      select i.item_name,i.quantity,i.description,i.artwork_path into label,stock,legacy_description,artwork from public.character_inventory i
      where (i.campaign_id,i.character_id,i.id) = (c,target,source_id) for update;
      if stock is null or stock < amount then raise exception 'Insufficient personal stock'; end if;
      select (i.details).* into details from public.character_inventory i where i.id = source_id;
      if details.category is null then
        details := row('other','common',0,0,legacy_description,false,false)::public.treasure_details;
      end if;
      if stock = amount then delete from public.character_inventory where id = source_id;
      else update public.character_inventory set quantity = stock - amount where id = source_id; end if;
    else
      select i.name,i.quantity,i.artwork_path into label,stock,artwork from public.inventory_group_contributions i
      where (i.campaign_id,i.group_id,i.id) = (c,party,source_id) for update;
      if stock is null or stock < amount then raise exception 'Insufficient group stock'; end if;
      select (i.details).* into details from public.inventory_group_contributions i where i.id = source_id;
      if stock = amount then delete from public.inventory_group_contributions where id = source_id;
      else update public.inventory_group_contributions set quantity = stock - amount where id = source_id; end if;
    end if;
    if action in ('deposit','to_group') then
      insert into public.inventory_group_contributions(campaign_id,group_id,contributed_by,category,name,quantity,details,artwork_path)
      values(c,party,auth.uid(),coalesce(details.category,'other'),label,amount,details,artwork);
    elsif action = 'to_character' then
      insert into public.character_inventory(campaign_id,character_id,item_name,quantity,description,details,artwork_path)
      values(c,target,label,amount,coalesce(details.description,''),details,artwork);
    end if;
  end if;
  perform campaign_private.record_treasury(c,party,target,session,action,label,amount,coin);
end;
$$;
