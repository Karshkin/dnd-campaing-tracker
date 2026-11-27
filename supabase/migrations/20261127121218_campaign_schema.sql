-- Campaign schema and permissions for the browser Data API.
create schema campaign_private;
revoke all on schema campaign_private from public;
grant usage on schema campaign_private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username varchar(50) not null check (char_length(trim(username)) between 3 and 50),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index profiles_username_unique on public.profiles (lower(username));

create table public.page_permissions (
  id integer generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  page_key varchar(50) not null,
  permission_level varchar(20) not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, page_key),
  check (page_key in ('tracker', 'characters', 'bestiary', 'organizations', 'npcs', 'admin')),
  check (permission_level in ('none', 'view', 'edit', 'admin'))
);

create table public.maps (
  id integer generated always as identity primary key,
  name varchar(120) not null,
  description text not null default '',
  file_path varchar(255) not null default '',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check (not is_active or file_path <> ''),
  check (char_length(name) > 0),
  check (file_path = '' or file_path ~ ('^' || 'maps/' || id::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'))
);

create table public.map_events (
  id integer generated always as identity primary key,
  map_id integer references public.maps(id) on delete set null,
  title varchar(120) not null,
  description text not null default '',
  event_type varchar(30) not null default 'event',
  latitude double precision not null,
  longitude double precision not null,
  image_path varchar(255),
  created_at timestamptz not null default now(),
  check (event_type in ('event', 'quest')),
  check (char_length(title) > 0),
  check (latitude between 0 and 100),
  check (longitude between 0 and 100),
  check (image_path = '' or image_path ~ ('^' || 'map_events/' || id::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'))
);
create index map_events_map_id_idx on public.map_events (map_id);

create table public.points_of_interest (
  id integer generated always as identity primary key,
  map_id integer references public.maps(id) on delete cascade not null,
  title varchar(120) not null,
  description text not null default '',
  poi_type varchar(30) not null default 'location',
  latitude double precision not null,
  longitude double precision not null,
  image_path varchar(255),
  created_at timestamptz not null default now(),
  check (poi_type in ('location', 'city', 'dungeon', 'landmark', 'quest')),
  check (char_length(title) > 0),
  check (latitude between 0 and 100),
  check (longitude between 0 and 100),
  check (image_path = '' or image_path ~ ('^' || 'points_of_interest/' || id::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'))
);
create index points_of_interest_map_id_idx on public.points_of_interest (map_id);

create table public.resources (
  id integer generated always as identity primary key,
  name varchar(120) not null unique,
  quantity integer not null default 0,
  notes text not null default '',
  image_path varchar(255),
  updated_at timestamptz not null default now(),
  check (quantity >= 0),
  check (char_length(name) > 0),
  check (image_path = '' or image_path ~ ('^' || 'resources/' || id::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'))
);

create table public.diary_entries (
  id integer generated always as identity primary key,
  title varchar(120) not null,
  content text not null,
  image_path varchar(255),
  created_at timestamptz not null default now(),
  check (char_length(title) > 0),
  check (char_length(content) > 0),
  check (image_path = '' or image_path ~ ('^' || 'diary_entries/' || id::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'))
);

create table public.organizations (
  id integer generated always as identity primary key,
  name varchar(120) not null,
  description text not null default '',
  image_path varchar(255),
  created_at timestamptz not null default now(),
  check (char_length(name) > 0),
  check (image_path = '' or image_path ~ ('^' || 'organizations/' || id::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'))
);

create table public.characters (
  id integer generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete cascade default auth.uid() not null,
  organization_id integer references public.organizations(id) on delete set null,
  name varchar(120) not null,
  character_class varchar(50) not null default '',
  level integer not null default 1,
  race varchar(50) not null default '',
  sheet_file_path varchar(255) not null default '',
  image_path varchar(255),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (level between 1 and 20),
  check (char_length(name) > 0),
  check (sheet_file_path = '' or sheet_file_path ~ ('^' || 'characters/' || user_id::text || '/' || id::text || '/[0-9a-f-]{36}\.(pdf|png|jpe?g|webp|gif|avif|bmp|tiff?)$')),
  check (image_path = '' or image_path ~ ('^' || 'characters/' || user_id::text || '/' || id::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'))
);
create index characters_user_id_idx on public.characters (user_id);
create index characters_organization_id_idx on public.characters (organization_id);

create table public.character_inventory (
  id integer generated always as identity primary key,
  character_id integer references public.characters(id) on delete cascade not null,
  item_name varchar(120) not null,
  quantity integer not null default 1,
  description text not null default '',
  created_at timestamptz not null default now(),
  check (quantity >= 1),
  check (char_length(item_name) > 0)
);
create index character_inventory_character_id_idx on public.character_inventory (character_id);

create table public.character_diary (
  id integer generated always as identity primary key,
  character_id integer references public.characters(id) on delete cascade not null,
  title varchar(120) not null,
  content text not null,
  session_date timestamptz,
  created_at timestamptz not null default now(),
  check (char_length(title) > 0),
  check (char_length(content) > 0)
);
create index character_diary_character_id_idx on public.character_diary (character_id);

create table public.creatures (
  id integer generated always as identity primary key,
  added_by_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  name varchar(120) not null,
  creature_type varchar(50) not null default '',
  challenge_rating varchar(20) not null default '',
  armor_class integer not null default 0,
  hit_points varchar(50) not null default '',
  speed varchar(100) not null default '',
  abilities text not null default '',
  weaknesses text not null default '',
  resistances text not null default '',
  immunities text not null default '',
  notes text not null default '',
  image_path varchar(255),
  created_at timestamptz not null default now(),
  check (armor_class >= 0),
  check (char_length(name) > 0),
  check (image_path = '' or image_path ~ ('^' || 'creatures/' || id::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'))
);
create index creatures_added_by_user_id_idx on public.creatures (added_by_user_id);

create table public.allies (
  id integer generated always as identity primary key,
  added_by_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  organization_id integer references public.organizations(id) on delete set null,
  name varchar(120) not null,
  role varchar(100) not null default '',
  location varchar(120) not null default '',
  relationship text not null default '',
  notes text not null default '',
  alignment varchar(20) not null default 'neutral',
  image_path varchar(255),
  created_at timestamptz not null default now(),
  check (alignment in ('allied', 'foe', 'neutral')),
  check (char_length(name) > 0),
  check (image_path = '' or image_path ~ ('^' || 'allies/' || id::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'))
);
create index allies_added_by_user_id_idx on public.allies (added_by_user_id);
create index allies_organization_id_idx on public.allies (organization_id);

-- User metadata is used only for the display name.
create function campaign_private.create_profile() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), 'player-' || new.id::text));

  insert into public.page_permissions (user_id, page_key, permission_level)
  select new.id, page_key, permission_level
  from (values ('tracker', 'view'), ('characters', 'edit'), ('bestiary', 'view'),
               ('organizations', 'view'), ('npcs', 'view'), ('admin', 'none'))
       as defaults(page_key, permission_level);

  return new;
end;
$$;
revoke all on function campaign_private.create_profile() from public, anon, authenticated;
create trigger campaign_profile_after_signup after insert on auth.users
for each row execute function campaign_private.create_profile();

create function campaign_private.permitted(section text, minimum integer) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select p.is_admin or coalesce(
      case a.permission_level when 'admin' then 3 when 'edit' then 2 when 'view' then 1 else 0 end, 0
    ) >= minimum
    from public.profiles p
    left join public.page_permissions a on a.user_id = p.id and a.page_key = section
    where p.id = (select auth.uid())
  ), false);
$$;
revoke all on function campaign_private.permitted(text, integer) from public, anon, authenticated;
grant execute on function campaign_private.permitted(text, integer) to authenticated;

alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select campaign_private.permitted('admin', 3)));

alter table public.page_permissions enable row level security;
revoke all on public.page_permissions from public, anon, authenticated;
grant select, update (permission_level) on public.page_permissions to authenticated;
create policy permissions_read on public.page_permissions for select to authenticated
using (user_id = (select auth.uid()) or (select campaign_private.permitted('admin', 3)));
create policy permissions_update on public.page_permissions for update to authenticated
using ((select campaign_private.permitted('admin', 3))
       and not (user_id = (select auth.uid()) and page_key = 'admin'))
with check ((select campaign_private.permitted('admin', 3))
       and not (user_id = (select auth.uid()) and page_key = 'admin'));

create function campaign_private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
revoke all on function campaign_private.touch_updated_at() from public, anon, authenticated;

create trigger page_permissions_touch before update on public.page_permissions for each row execute function campaign_private.touch_updated_at();
create trigger characters_touch before update on public.characters for each row execute function campaign_private.touch_updated_at();
create trigger resources_touch before update on public.resources for each row execute function campaign_private.touch_updated_at();

alter table public.maps enable row level security;
revoke all on public.maps from public, anon, authenticated;
grant select, insert (name, description, file_path, is_active), delete on public.maps to authenticated;
grant usage on sequence public.maps_id_seq to authenticated;
create policy maps_read on public.maps for select to authenticated using (((select campaign_private.permitted('tracker', 1)) and is_active) or (select campaign_private.permitted('admin', 3)));
create policy maps_insert on public.maps for insert to authenticated
with check ((select campaign_private.permitted('admin', 3)));
grant update (name, description, file_path, is_active) on public.maps to authenticated;
create policy maps_update on public.maps for update to authenticated
using ((select campaign_private.permitted('admin', 3))) with check ((select campaign_private.permitted('admin', 3)));
create policy maps_delete on public.maps for delete to authenticated using ((select campaign_private.permitted('admin', 3)));

alter table public.map_events enable row level security;
revoke all on public.map_events from public, anon, authenticated;
grant select, insert (map_id, title, description, event_type, latitude, longitude, image_path), delete on public.map_events to authenticated;
grant usage on sequence public.map_events_id_seq to authenticated;
create policy map_events_read on public.map_events for select to authenticated using ((select campaign_private.permitted('tracker', 1)));
create policy map_events_insert on public.map_events for insert to authenticated
with check ((select campaign_private.permitted('tracker', 2)));
grant update (map_id, title, description, event_type, latitude, longitude, image_path) on public.map_events to authenticated;
create policy map_events_update on public.map_events for update to authenticated
using ((select campaign_private.permitted('tracker', 2))) with check ((select campaign_private.permitted('tracker', 2)));
create policy map_events_delete on public.map_events for delete to authenticated using ((select campaign_private.permitted('tracker', 2)));

alter table public.points_of_interest enable row level security;
revoke all on public.points_of_interest from public, anon, authenticated;
grant select, insert (map_id, title, description, poi_type, latitude, longitude, image_path), delete on public.points_of_interest to authenticated;
grant usage on sequence public.points_of_interest_id_seq to authenticated;
create policy points_of_interest_read on public.points_of_interest for select to authenticated using ((select campaign_private.permitted('tracker', 1)));
create policy points_of_interest_insert on public.points_of_interest for insert to authenticated
with check ((select campaign_private.permitted('tracker', 2)));
grant update (map_id, title, description, poi_type, latitude, longitude, image_path) on public.points_of_interest to authenticated;
create policy points_of_interest_update on public.points_of_interest for update to authenticated
using ((select campaign_private.permitted('tracker', 2))) with check ((select campaign_private.permitted('tracker', 2)));
create policy points_of_interest_delete on public.points_of_interest for delete to authenticated using ((select campaign_private.permitted('tracker', 2)));

alter table public.resources enable row level security;
revoke all on public.resources from public, anon, authenticated;
grant select, insert (name, quantity, notes, image_path), delete on public.resources to authenticated;
grant usage on sequence public.resources_id_seq to authenticated;
create policy resources_read on public.resources for select to authenticated using ((select campaign_private.permitted('tracker', 1)));
create policy resources_insert on public.resources for insert to authenticated
with check ((select campaign_private.permitted('tracker', 2)));
grant update (name, quantity, notes, image_path) on public.resources to authenticated;
create policy resources_update on public.resources for update to authenticated
using ((select campaign_private.permitted('tracker', 2))) with check ((select campaign_private.permitted('tracker', 2)));
create policy resources_delete on public.resources for delete to authenticated using ((select campaign_private.permitted('tracker', 2)));

alter table public.diary_entries enable row level security;
revoke all on public.diary_entries from public, anon, authenticated;
grant select, insert (title, content, image_path), delete on public.diary_entries to authenticated;
grant usage on sequence public.diary_entries_id_seq to authenticated;
create policy diary_entries_read on public.diary_entries for select to authenticated using ((select campaign_private.permitted('tracker', 1)));
create policy diary_entries_insert on public.diary_entries for insert to authenticated
with check ((select campaign_private.permitted('tracker', 2)));
grant update (image_path) on public.diary_entries to authenticated;
create policy diary_entries_update on public.diary_entries for update to authenticated
using ((select campaign_private.permitted('tracker', 2))) with check ((select campaign_private.permitted('tracker', 2)));
create policy diary_entries_delete on public.diary_entries for delete to authenticated using ((select campaign_private.permitted('tracker', 2)));

alter table public.organizations enable row level security;
revoke all on public.organizations from public, anon, authenticated;
grant select, insert (name, description, image_path), delete on public.organizations to authenticated;
grant usage on sequence public.organizations_id_seq to authenticated;
create policy organizations_read on public.organizations for select to authenticated using ((select campaign_private.permitted('organizations', 1)));
create policy organizations_insert on public.organizations for insert to authenticated
with check ((select campaign_private.permitted('organizations', 2)));
grant update (image_path) on public.organizations to authenticated;
create policy organizations_update on public.organizations for update to authenticated
using ((select campaign_private.permitted('organizations', 2))) with check ((select campaign_private.permitted('organizations', 2)));
create policy organizations_delete on public.organizations for delete to authenticated using ((select campaign_private.permitted('organizations', 2)));

alter table public.characters enable row level security;
revoke all on public.characters from public, anon, authenticated;
grant select, insert (organization_id, name, character_class, level, race, sheet_file_path, image_path, notes), delete on public.characters to authenticated;
grant usage on sequence public.characters_id_seq to authenticated;
create policy characters_read on public.characters for select to authenticated using ((select campaign_private.permitted('characters', 1)) and user_id = (select auth.uid()));
create policy characters_insert on public.characters for insert to authenticated
with check ((select campaign_private.permitted('characters', 2)) and user_id = (select auth.uid()));
grant update (organization_id, name, character_class, level, race, sheet_file_path, image_path, notes) on public.characters to authenticated;
create policy characters_update on public.characters for update to authenticated
using ((select campaign_private.permitted('characters', 2)) and user_id = (select auth.uid())) with check ((select campaign_private.permitted('characters', 2)) and user_id = (select auth.uid()));
create policy characters_delete on public.characters for delete to authenticated using ((select campaign_private.permitted('characters', 2)) and user_id = (select auth.uid()));

alter table public.character_inventory enable row level security;
revoke all on public.character_inventory from public, anon, authenticated;
grant select, insert (character_id, item_name, quantity, description), delete on public.character_inventory to authenticated;
grant usage on sequence public.character_inventory_id_seq to authenticated;
create policy character_inventory_read on public.character_inventory for select to authenticated using ((select campaign_private.permitted('characters', 1)) and exists (select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid())));
create policy character_inventory_insert on public.character_inventory for insert to authenticated
with check ((select campaign_private.permitted('characters', 2)) and exists (select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid())));
create policy character_inventory_delete on public.character_inventory for delete to authenticated using ((select campaign_private.permitted('characters', 2)) and exists (select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid())));

alter table public.character_diary enable row level security;
revoke all on public.character_diary from public, anon, authenticated;
grant select, insert (character_id, title, content, session_date) on public.character_diary to authenticated;
grant usage on sequence public.character_diary_id_seq to authenticated;
create policy character_diary_read on public.character_diary for select to authenticated using ((select campaign_private.permitted('characters', 1)) and exists (select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid())));
create policy character_diary_insert on public.character_diary for insert to authenticated
with check ((select campaign_private.permitted('characters', 2)) and exists (select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid())));

alter table public.creatures enable row level security;
revoke all on public.creatures from public, anon, authenticated;
grant select, insert (name, creature_type, challenge_rating, armor_class, hit_points, speed, abilities, weaknesses, resistances, immunities, notes, image_path), delete on public.creatures to authenticated;
grant usage on sequence public.creatures_id_seq to authenticated;
create policy creatures_read on public.creatures for select to authenticated using ((select campaign_private.permitted('bestiary', 1)));
create policy creatures_insert on public.creatures for insert to authenticated
with check ((select campaign_private.permitted('bestiary', 2)) and added_by_user_id = (select auth.uid()));
grant update (image_path) on public.creatures to authenticated;
create policy creatures_update on public.creatures for update to authenticated
using ((select campaign_private.permitted('bestiary', 2))) with check ((select campaign_private.permitted('bestiary', 2)));
create policy creatures_delete on public.creatures for delete to authenticated using ((select campaign_private.permitted('bestiary', 2)));

alter table public.allies enable row level security;
revoke all on public.allies from public, anon, authenticated;
grant select, insert (organization_id, name, role, location, relationship, notes, alignment, image_path), delete on public.allies to authenticated;
grant usage on sequence public.allies_id_seq to authenticated;
create policy allies_read on public.allies for select to authenticated using ((select campaign_private.permitted('npcs', 1)));
create policy allies_insert on public.allies for insert to authenticated
with check ((select campaign_private.permitted('npcs', 2)) and added_by_user_id = (select auth.uid()));
grant update (image_path, alignment) on public.allies to authenticated;
create policy allies_update on public.allies for update to authenticated
using ((select campaign_private.permitted('npcs', 2))) with check ((select campaign_private.permitted('npcs', 2)));
create policy allies_delete on public.allies for delete to authenticated using ((select campaign_private.permitted('npcs', 2)));

-- Storage policies look up object paths on their parent relation.
create index maps_file_path_idx on public.maps (file_path);
create index map_events_image_path_idx on public.map_events (image_path);
create index points_of_interest_image_path_idx on public.points_of_interest (image_path);
create index resources_image_path_idx on public.resources (image_path);
create index diary_entries_image_path_idx on public.diary_entries (image_path);
create index organizations_image_path_idx on public.organizations (image_path);
create index characters_sheet_file_path_idx on public.characters (sheet_file_path);
create index characters_image_path_idx on public.characters (image_path);
create index creatures_image_path_idx on public.creatures (image_path);
create index allies_image_path_idx on public.allies (image_path);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-files', 'campaign-files', false, 52428800,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
              'image/avif', 'image/bmp', 'image/tiff']);

-- Match the object to its exact table and row. Character paths also carry the owner UUID.
-- Read access follows the live record, and writers can stage an object before linking it.
create function campaign_private.campaign_file_access(object_name text, operation text) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select case split_part(object_name, '/', 1)
    when 'maps' then object_name ~ '^maps/[1-9][0-9]*/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$' and (
      (operation = 'read' and exists (select 1 from public.maps r where r.file_path = object_name)) or
      ((select campaign_private.permitted('admin', 3)) and (
        (operation = 'insert' and exists (select 1 from public.maps r where ('maps/' || r.id::text) = regexp_replace(object_name, '/[^/]+$', ''))) or
        (operation in ('delete', 'read') and not exists (select 1 from public.maps r where r.file_path = object_name))
      ))
    )
    when 'map_events' then object_name ~ '^map_events/[1-9][0-9]*/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$' and (
      (operation = 'read' and exists (select 1 from public.map_events r where r.image_path = object_name)) or
      ((select campaign_private.permitted('tracker', 2)) and (
        (operation = 'insert' and exists (select 1 from public.map_events r where ('map_events/' || r.id::text) = regexp_replace(object_name, '/[^/]+$', ''))) or
        (operation in ('delete', 'read') and not exists (select 1 from public.map_events r where r.image_path = object_name))
      ))
    )
    when 'points_of_interest' then object_name ~ '^points_of_interest/[1-9][0-9]*/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$' and (
      (operation = 'read' and exists (select 1 from public.points_of_interest r where r.image_path = object_name)) or
      ((select campaign_private.permitted('tracker', 2)) and (
        (operation = 'insert' and exists (select 1 from public.points_of_interest r where ('points_of_interest/' || r.id::text) = regexp_replace(object_name, '/[^/]+$', ''))) or
        (operation in ('delete', 'read') and not exists (select 1 from public.points_of_interest r where r.image_path = object_name))
      ))
    )
    when 'resources' then object_name ~ '^resources/[1-9][0-9]*/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$' and (
      (operation = 'read' and exists (select 1 from public.resources r where r.image_path = object_name)) or
      ((select campaign_private.permitted('tracker', 2)) and (
        (operation = 'insert' and exists (select 1 from public.resources r where ('resources/' || r.id::text) = regexp_replace(object_name, '/[^/]+$', ''))) or
        (operation in ('delete', 'read') and not exists (select 1 from public.resources r where r.image_path = object_name))
      ))
    )
    when 'diary_entries' then object_name ~ '^diary_entries/[1-9][0-9]*/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$' and (
      (operation = 'read' and exists (select 1 from public.diary_entries r where r.image_path = object_name)) or
      ((select campaign_private.permitted('tracker', 2)) and (
        (operation = 'insert' and exists (select 1 from public.diary_entries r where ('diary_entries/' || r.id::text) = regexp_replace(object_name, '/[^/]+$', ''))) or
        (operation in ('delete', 'read') and not exists (select 1 from public.diary_entries r where r.image_path = object_name))
      ))
    )
    when 'organizations' then object_name ~ '^organizations/[1-9][0-9]*/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$' and (
      (operation = 'read' and exists (select 1 from public.organizations r where r.image_path = object_name)) or
      ((select campaign_private.permitted('organizations', 2)) and (
        (operation = 'insert' and exists (select 1 from public.organizations r where ('organizations/' || r.id::text) = regexp_replace(object_name, '/[^/]+$', ''))) or
        (operation in ('delete', 'read') and not exists (select 1 from public.organizations r where r.image_path = object_name))
      ))
    )
    when 'characters' then object_name ~ '^characters/[0-9a-f-]{36}/[1-9][0-9]*/[0-9a-f-]{36}\.(pdf|png|jpe?g|webp|gif|avif|bmp|tiff?)$' and split_part(object_name, '/', 2) = (select auth.uid())::text and (
      (operation = 'read' and exists (select 1 from public.characters r where r.sheet_file_path = object_name or r.image_path = object_name)) or
      ((select campaign_private.permitted('characters', 2)) and (
        (operation = 'insert' and exists (select 1 from public.characters r where ('characters/' || r.user_id::text || '/' || r.id::text) = regexp_replace(object_name, '/[^/]+$', ''))) or
        (operation in ('delete', 'read') and not exists (select 1 from public.characters r where r.sheet_file_path = object_name or r.image_path = object_name))
      ))
    )
    when 'creatures' then object_name ~ '^creatures/[1-9][0-9]*/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$' and (
      (operation = 'read' and exists (select 1 from public.creatures r where r.image_path = object_name)) or
      ((select campaign_private.permitted('bestiary', 2)) and (
        (operation = 'insert' and exists (select 1 from public.creatures r where ('creatures/' || r.id::text) = regexp_replace(object_name, '/[^/]+$', ''))) or
        (operation in ('delete', 'read') and not exists (select 1 from public.creatures r where r.image_path = object_name))
      ))
    )
    when 'allies' then object_name ~ '^allies/[1-9][0-9]*/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$' and (
      (operation = 'read' and exists (select 1 from public.allies r where r.image_path = object_name)) or
      ((select campaign_private.permitted('npcs', 2)) and (
        (operation = 'insert' and exists (select 1 from public.allies r where ('allies/' || r.id::text) = regexp_replace(object_name, '/[^/]+$', ''))) or
        (operation in ('delete', 'read') and not exists (select 1 from public.allies r where r.image_path = object_name))
      ))
    )
    else false
  end;
$$;
revoke all on function campaign_private.campaign_file_access(text, text) from public, anon, authenticated;
grant execute on function campaign_private.campaign_file_access(text, text) to authenticated;

create policy campaign_files_read on storage.objects for select to authenticated
using (bucket_id = 'campaign-files' and campaign_private.campaign_file_access(name, 'read'));
create policy campaign_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'campaign-files' and campaign_private.campaign_file_access(name, 'insert')
            and (lower(right(name, 4)) <> '.pdf' or name like 'characters/%'));
create policy campaign_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'campaign-files' and campaign_private.campaign_file_access(name, 'delete'));
