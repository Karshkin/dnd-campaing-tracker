alter table public.diary_entries
  add column author_character_id integer,
  add column author_user_id uuid references public.profiles(id) on delete set null,
  add column author_character_name text,
  add column author_account_name text,
  add column visibility text not null default 'shared' check (visibility in ('shared','private')),
  add column session_id uuid,
  add foreign key (campaign_id,author_character_id) references public.characters(campaign_id,id) on delete set null (author_character_id),
  add foreign key (campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete set null (session_id);
create index diary_author_idx on public.diary_entries(author_user_id);
create index diary_session_idx on public.diary_entries(session_id);

alter table public.chronicle_quests
  add column author_character_id integer,
  add column author_user_id uuid references public.profiles(id) on delete set null,
  add column author_character_name text,
  add column author_account_name text,
  add column visibility text not null default 'shared' check (visibility in ('shared','private')),
  add column proposed_status text not null default 'active' check (proposed_status in ('active','completed','failed')),
  add column priority text not null default 'normal' check (priority in ('low','normal','high')),
  add column rewards text not null default '',
  add column objectives jsonb not null default '[]' check (jsonb_typeof(objectives) = 'array'),
  add column participants integer[] not null default '{}',
  add column npc_ids integer[] not null default '{}',
  add column organization_ids integer[] not null default '{}',
  add column creature_ids integer[] not null default '{}',
  add column place_ids integer[] not null default '{}',
  add foreign key (campaign_id,author_character_id) references public.characters(campaign_id,id) on delete set null (author_character_id);
update public.chronicle_quests set proposed_status = status where status <> 'active';
create index quest_author_idx on public.chronicle_quests(author_user_id);

create function campaign_private.sign_chronicle_record() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.author_user_id := auth.uid();
  if new.author_user_id is null then return new; end if;
  select p.username into strict new.author_account_name from public.profiles p where p.id = new.author_user_id;
  if new.author_character_id is null and campaign_private.is_campaign_director(new.campaign_id) then return new; end if;
  select c.name into new.author_character_name from public.characters c
  where (c.campaign_id,c.id,c.user_id) = (new.campaign_id,new.author_character_id,new.author_user_id);
  if not found then raise exception 'Selecciona un personaje propio de esta campaña' using errcode = '42501'; end if;
  return new;
end;
$$;
revoke all on function campaign_private.sign_chronicle_record() from public,anon,authenticated;
create trigger diary_signature before insert on public.diary_entries
for each row execute function campaign_private.sign_chronicle_record();
create trigger quest_signature before insert on public.chronicle_quests
for each row execute function campaign_private.sign_chronicle_record();

create function campaign_private.can_read_chronicle_record(c uuid, visibility text, author uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select campaign_private.is_campaign_director(c) or (
    campaign_private.permitted_in(c,'tracker',1) and (visibility = 'shared' or author = (select auth.uid()))
  );
$$;
revoke all on function campaign_private.can_read_chronicle_record(uuid,text,uuid) from public,anon,authenticated;
grant execute on function campaign_private.can_read_chronicle_record(uuid,text,uuid) to authenticated;

create function campaign_private.can_edit_chronicle_record(c uuid, author uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select campaign_private.is_campaign_director(c) or (
    author = (select auth.uid()) and campaign_private.permitted_in(c,'tracker',1)
  );
$$;
revoke all on function campaign_private.can_edit_chronicle_record(uuid,uuid) from public,anon,authenticated;
grant execute on function campaign_private.can_edit_chronicle_record(uuid,uuid) to authenticated;

grant insert(author_character_id,visibility,session_id),
  update(title,content,visibility,session_id) on public.diary_entries to authenticated;
alter policy diary_entries_read on public.diary_entries
using (campaign_private.can_read_chronicle_record(campaign_id,visibility,author_user_id));
alter policy diary_entries_insert on public.diary_entries
with check (campaign_private.can_edit_chronicle_record(campaign_id,author_user_id));
alter policy diary_entries_update on public.diary_entries
using (campaign_private.can_edit_chronicle_record(campaign_id,author_user_id))
with check (campaign_private.can_edit_chronicle_record(campaign_id,author_user_id));
alter policy diary_entries_delete on public.diary_entries
using (campaign_private.can_edit_chronicle_record(campaign_id,author_user_id));

create function campaign_private.validate_chronicle_session() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is not null and new.session_id is not null and not exists(
    select 1 from public.chronicle_sessions s where (s.campaign_id,s.id) = (new.campaign_id,new.session_id)
  ) and not campaign_private.is_campaign_director(new.campaign_id) then
    raise exception 'Sesión no disponible' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function campaign_private.validate_chronicle_session() from public,anon,authenticated;
create trigger diary_session_access before insert or update of session_id on public.diary_entries
for each row execute function campaign_private.validate_chronicle_session();
create trigger quest_session_access before insert or update of session_id on public.chronicle_quests
for each row execute function campaign_private.validate_chronicle_session();

revoke insert, update on public.chronicle_quests from authenticated;
grant insert(title,description,session_id,status,author_character_id,visibility,proposed_status,priority,
  rewards,objectives,participants,npc_ids,organization_ids,creature_ids,place_ids),
update(title,description,session_id,status,visibility,proposed_status,priority,rewards,objectives,
  participants,npc_ids,organization_ids,creature_ids,place_ids) on public.chronicle_quests to authenticated;
create policy quest_visibility on public.chronicle_quests as restrictive for select to authenticated
using (campaign_private.can_read_chronicle_record(campaign_id,visibility,author_user_id));
create policy quest_player_insert on public.chronicle_quests for insert to authenticated
with check (campaign_id = (select campaign_private.selected_campaign()) and
  campaign_private.can_edit_chronicle_record(campaign_id,author_user_id));
create policy quest_player_update on public.chronicle_quests for update to authenticated
using (campaign_id = (select campaign_private.selected_campaign()) and author_user_id = (select auth.uid())
  and campaign_private.permitted_in(campaign_id,'tracker',1))
with check (campaign_id = (select campaign_private.selected_campaign()) and author_user_id = (select auth.uid())
  and campaign_private.permitted_in(campaign_id,'tracker',1));

create function campaign_private.validate_chronicle_quest() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare link record;
declare ids integer[];
declare previous integer[];
declare permitted_count integer;
begin
  if auth.uid() is not null and not campaign_private.is_campaign_director(new.campaign_id)
    and ((tg_op = 'INSERT' and (new.status <> 'active' or new.rewards <> ''))
      or (tg_op = 'UPDATE' and (new.status is distinct from old.status or new.rewards is distinct from old.rewards))) then
    raise exception 'El estado oficial y las recompensas requieren permiso de director' using errcode = '42501';
  end if;
  if jsonb_typeof(new.objectives) <> 'array' or jsonb_array_length(new.objectives) > 100
    or exists(select 1 from jsonb_array_elements(new.objectives) o
      where jsonb_typeof(o->'title') is distinct from 'string'
        or length(btrim(o->>'title')) not between 1 and 500
        or jsonb_typeof(o->'done') is distinct from 'boolean') then
    raise exception 'Objetivos inválidos';
  end if;
  for link in select * from (values
    ('participants','characters',null), ('npc_ids','allies','npcs'),
    ('organization_ids','organizations','organizations'), ('creature_ids','creatures','bestiary'),
    ('place_ids','points_of_interest','tracker')
  ) as fields(column_name,relation,section) loop
    execute format('select ($1).%I',link.column_name) into ids using new;
    if tg_op = 'UPDATE' then
      execute format('select ($1).%I',link.column_name) into previous using old;
      if ids is not distinct from previous then continue; end if;
    end if;
    if cardinality(ids) > 100 or (cardinality(ids) > 0 and link.section is not null
      and auth.uid() is not null and not campaign_private.permitted_in(new.campaign_id,link.section,1)) then
      raise exception 'Vinculaciones no disponibles' using errcode = '42501';
    end if;
    execute format('select count(*) from public.%I where campaign_id = $1 and id = any($2)',link.relation)
      into permitted_count using new.campaign_id,ids;
    if cardinality(ids) <> permitted_count then
      raise exception 'Vinculaciones no disponibles' using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function campaign_private.validate_chronicle_quest() from public,anon,authenticated;
create trigger quest_validate before insert or update on public.chronicle_quests
for each row execute function campaign_private.validate_chronicle_quest();

alter table public.campaign_comments
  add column diary_id integer,
  add foreign key (campaign_id,diary_id) references public.diary_entries(campaign_id,id) on delete cascade;
alter table public.campaign_comments drop constraint campaign_comments_check;
alter table public.campaign_comments add check (
  num_nonnulls(map_id,character_id,creature_id,ally_id,organization_id,diary_id) = 1
);
create index diary_comments_idx on public.campaign_comments(diary_id,id) where diary_id is not null;
grant select(diary_id),insert(diary_id) on public.campaign_comments to authenticated;
alter policy campaign_comments_read on public.campaign_comments
using (campaign_private.permitted(case when diary_id is null then section else 'tracker' end,1)
  and (map_id is null or exists (select 1 from public.maps m where m.id = map_id and m.is_active))
  and (diary_id is null or exists (select 1 from public.diary_entries d where d.id = diary_id)));
alter policy campaign_comments_add on public.campaign_comments
with check (campaign_private.permitted(case when diary_id is null then section else 'tracker' end,1)
  and (map_id is null or exists (select 1 from public.maps m where m.id = map_id and m.is_active))
  and (diary_id is null or exists (select 1 from public.diary_entries d where d.id = diary_id))
  and exists (select 1 from public.characters c where c.id = author_character_id and c.user_id = (select auth.uid())));

create or replace function campaign_private.remember_asset_parent() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into campaign_private.asset_parents(relation_name,entry_id,campaign_id,owner_id)
  values (tg_table_name,new.id,new.campaign_id,
    (to_jsonb(new) ->> case when tg_table_name = 'diary_entries' then 'author_user_id' else 'user_id' end)::uuid);
  return new;
end;
$$;

create or replace function campaign_private.scoped_asset_access(bucket text, path text, operation text) returns boolean
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
  diary public.diary_entries%rowtype;
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

  if relation = 'diary_entries' then
    select * into diary from public.diary_entries d where (d.campaign_id,d.id) = (campaign,row_id::integer);
    if not found then
      return operation in ('read','delete') and campaign_private.can_edit_chronicle_record(campaign,owner_id);
    end if;
    can_write := campaign_private.can_edit_chronicle_record(campaign,diary.author_user_id);
    linked := coalesce(diary.image_path = path,false);
    return case operation
      when 'read' then (linked and campaign_private.can_read_chronicle_record(campaign,diary.visibility,diary.author_user_id))
        or (not linked and can_write)
      when 'insert' then can_write
      when 'delete' then can_write and not linked
      else false end;
  end if;

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
