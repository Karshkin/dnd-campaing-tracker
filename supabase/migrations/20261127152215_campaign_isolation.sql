-- Backfill existing campaign content and permissions without changing record IDs or object paths.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  description text not null default '' check (length(description) <= 2000),
  theme text not null default 'parchment' check (theme in ('parchment','dark','arcane')),
  accent text not null default '#8b4513' check (accent ~ '^#[0-9A-Fa-f]{6}$'),
  cover_path text,
  emblem_path text,
  check (cover_path is null or cover_path ~ ('^' || id::text || '/cover/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$')),
  check (emblem_path is null or emblem_path ~ ('^' || id::text || '/emblem/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'))
);

create table public.campaign_members (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_director boolean not null default false,
  primary key (campaign_id,user_id)
);
create index campaign_member_user_idx on public.campaign_members(user_id,campaign_id);

insert into public.campaigns(id,name) values ('00000000-0000-4000-8000-000000000001','Tiranía de los dragones');
insert into public.campaign_members(campaign_id,user_id,is_director)
select '00000000-0000-4000-8000-000000000001',id,is_admin from public.profiles;

create function campaign_private.selected_campaign() returns uuid
language sql stable set search_path = ''
as $$
  select case
    when headers ->> 'x-campaign-id' is null then '00000000-0000-4000-8000-000000000001'::uuid
    when headers ->> 'x-campaign-id' ~ '^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$'
      then (headers ->> 'x-campaign-id')::uuid
  end
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as headers) r;
$$;
revoke all on function campaign_private.selected_campaign() from public, anon, authenticated;
grant execute on function campaign_private.selected_campaign() to authenticated;

alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
revoke all on public.campaigns, public.campaign_members from public, anon, authenticated;
grant select on public.campaigns, public.campaign_members to authenticated;

create function campaign_private.is_campaign_member(target_campaign uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.campaign_members m
    where m.campaign_id = target_campaign and m.user_id = (select auth.uid()));
$$;

create function campaign_private.is_campaign_director(target_campaign uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.campaign_members m
    where m.campaign_id = target_campaign and m.user_id = (select auth.uid()) and m.is_director);
$$;
revoke all on function campaign_private.is_campaign_member(uuid), campaign_private.is_campaign_director(uuid)
from public, anon, authenticated;
grant execute on function campaign_private.is_campaign_member(uuid), campaign_private.is_campaign_director(uuid) to authenticated;

create policy campaigns_member_read on public.campaigns for select to authenticated
using (campaign_private.is_campaign_member(id));
create policy campaign_members_read on public.campaign_members for select to authenticated
using (user_id = (select auth.uid()) or campaign_private.is_campaign_director(campaign_id));

alter table public.page_permissions
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.page_permissions alter column campaign_id set default campaign_private.selected_campaign();
alter table public.page_permissions drop constraint page_permissions_user_id_page_key_key;
alter table public.page_permissions add unique (campaign_id,user_id,page_key);
alter table public.page_permissions add constraint permission_campaign_member_fk
  foreign key (campaign_id,user_id) references public.campaign_members on delete cascade deferrable initially deferred;

create function campaign_private.permitted_in(target_campaign uuid, section text, minimum integer) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select m.is_director or coalesce(
      case p.permission_level when 'admin' then 3 when 'edit' then 2 when 'view' then 1 else 0 end, 0
    ) >= minimum
    from public.campaign_members m
    left join public.page_permissions p
      on p.campaign_id = m.campaign_id and p.user_id = m.user_id and p.page_key = section
    where m.campaign_id = target_campaign and m.user_id = (select auth.uid())
  ), false);
$$;
revoke all on function campaign_private.permitted_in(uuid,text,integer) from public, anon, authenticated;
grant execute on function campaign_private.permitted_in(uuid,text,integer) to authenticated;

create or replace function campaign_private.permitted(section text, minimum integer) returns boolean
language sql stable security definer set search_path = ''
as $$ select campaign_private.permitted_in(campaign_private.selected_campaign(), section, minimum); $$;

create or replace function campaign_private.create_profile() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id,username)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), 'player-' || new.id::text));
  return new;
end;
$$;

-- Profiles remain account-wide, while any roster and permission lookups are scoped.
alter policy profiles_read on public.profiles using (
  id = (select auth.uid()) or (
    (select campaign_private.is_campaign_director(campaign_private.selected_campaign()))
    and exists(select 1 from public.campaign_members m
      where m.campaign_id = (select campaign_private.selected_campaign()) and m.user_id = profiles.id)
  )
);

alter policy permissions_read on public.page_permissions using (
  campaign_id = (select campaign_private.selected_campaign())
  and (user_id = (select auth.uid()) or (select campaign_private.permitted('admin',3)))
);

-- Roster mutations go through the campaign membership actions rather than account-wide writes.
revoke update (permission_level) on public.page_permissions from authenticated;
drop policy permissions_update on public.page_permissions;

alter table public.maps
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.maps alter column campaign_id set default campaign_private.selected_campaign();
create index maps_campaign_idx on public.maps(campaign_id);
create policy maps_campaign_scope on public.maps as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.map_events
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.map_events alter column campaign_id set default campaign_private.selected_campaign();
create index map_events_campaign_idx on public.map_events(campaign_id);
create policy map_events_campaign_scope on public.map_events as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.points_of_interest
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.points_of_interest alter column campaign_id set default campaign_private.selected_campaign();
create index points_of_interest_campaign_idx on public.points_of_interest(campaign_id);
create policy points_of_interest_campaign_scope on public.points_of_interest as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.resources
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.resources alter column campaign_id set default campaign_private.selected_campaign();
create index resources_campaign_idx on public.resources(campaign_id);
create policy resources_campaign_scope on public.resources as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.diary_entries
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.diary_entries alter column campaign_id set default campaign_private.selected_campaign();
create index diary_entries_campaign_idx on public.diary_entries(campaign_id);
create policy diary_entries_campaign_scope on public.diary_entries as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.organizations
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.organizations alter column campaign_id set default campaign_private.selected_campaign();
create index organizations_campaign_idx on public.organizations(campaign_id);
create policy organizations_campaign_scope on public.organizations as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.characters
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.characters alter column campaign_id set default campaign_private.selected_campaign();
create index characters_campaign_idx on public.characters(campaign_id);
create policy characters_campaign_scope on public.characters as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.creatures
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.creatures alter column campaign_id set default campaign_private.selected_campaign();
create index creatures_campaign_idx on public.creatures(campaign_id);
create policy creatures_campaign_scope on public.creatures as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.allies
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.allies alter column campaign_id set default campaign_private.selected_campaign();
create index allies_campaign_idx on public.allies(campaign_id);
create policy allies_campaign_scope on public.allies as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.inventory_groups
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.inventory_groups alter column campaign_id set default campaign_private.selected_campaign();
create index inventory_groups_campaign_idx on public.inventory_groups(campaign_id);
create policy inventory_groups_campaign_scope on public.inventory_groups as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.character_inventory
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.character_inventory alter column campaign_id set default campaign_private.selected_campaign();
create index character_inventory_campaign_idx on public.character_inventory(campaign_id);
create policy character_inventory_campaign_scope on public.character_inventory as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.character_diary
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.character_diary alter column campaign_id set default campaign_private.selected_campaign();
create index character_diary_campaign_idx on public.character_diary(campaign_id);
create policy character_diary_campaign_scope on public.character_diary as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.character_gallery
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.character_gallery alter column campaign_id set default campaign_private.selected_campaign();
create index character_gallery_campaign_idx on public.character_gallery(campaign_id);
create policy character_gallery_campaign_scope on public.character_gallery as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.character_private_fields
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.character_private_fields alter column campaign_id set default campaign_private.selected_campaign();
create index character_private_fields_campaign_idx on public.character_private_fields(campaign_id);
create policy character_private_fields_campaign_scope on public.character_private_fields as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.campaign_entry_images
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.campaign_entry_images alter column campaign_id set default campaign_private.selected_campaign();
create index campaign_entry_images_campaign_idx on public.campaign_entry_images(campaign_id);
create policy campaign_entry_images_campaign_scope on public.campaign_entry_images as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.campaign_entry_private_fields
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.campaign_entry_private_fields alter column campaign_id set default campaign_private.selected_campaign();
create index campaign_entry_private_fields_campaign_idx on public.campaign_entry_private_fields(campaign_id);
create policy campaign_entry_private_fields_campaign_scope on public.campaign_entry_private_fields as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.inventory_group_members
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.inventory_group_members alter column campaign_id set default campaign_private.selected_campaign();
create index inventory_group_members_campaign_idx on public.inventory_group_members(campaign_id);
create policy inventory_group_members_campaign_scope on public.inventory_group_members as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.inventory_group_contributions
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.inventory_group_contributions alter column campaign_id set default campaign_private.selected_campaign();
create index inventory_group_contributions_campaign_idx on public.inventory_group_contributions(campaign_id);
create policy inventory_group_contributions_campaign_scope on public.inventory_group_contributions as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.campaign_comments
  add column campaign_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.campaigns on delete cascade;
alter table public.campaign_comments alter column campaign_id set default campaign_private.selected_campaign();
create index campaign_comments_campaign_idx on public.campaign_comments(campaign_id);
create policy campaign_comments_campaign_scope on public.campaign_comments as restrictive for all to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())))
with check (campaign_id = (select campaign_private.selected_campaign())
  and (select campaign_private.is_campaign_member(campaign_private.selected_campaign())));
alter table public.maps add unique (campaign_id,id);
alter table public.map_events add unique (campaign_id,id);
alter table public.points_of_interest add unique (campaign_id,id);
alter table public.resources add unique (campaign_id,id);
alter table public.diary_entries add unique (campaign_id,id);
alter table public.organizations add unique (campaign_id,id);
alter table public.characters add unique (campaign_id,id);
alter table public.creatures add unique (campaign_id,id);
alter table public.allies add unique (campaign_id,id);
alter table public.inventory_groups add unique (campaign_id,id);
alter table public.map_events add constraint map_events_map_id_campaign_fk
  foreign key (campaign_id,map_id) references public.maps(campaign_id,id)
  deferrable initially deferred;
alter table public.points_of_interest add constraint points_of_interest_map_id_campaign_fk
  foreign key (campaign_id,map_id) references public.maps(campaign_id,id)
  deferrable initially deferred;
alter table public.characters add constraint characters_organization_id_campaign_fk
  foreign key (campaign_id,organization_id) references public.organizations(campaign_id,id)
  deferrable initially deferred;
alter table public.allies add constraint allies_organization_id_campaign_fk
  foreign key (campaign_id,organization_id) references public.organizations(campaign_id,id)
  deferrable initially deferred;
alter table public.character_inventory add constraint character_inventory_character_id_campaign_fk
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id)
  deferrable initially deferred;
alter table public.character_diary add constraint character_diary_character_id_campaign_fk
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id)
  deferrable initially deferred;
alter table public.character_gallery add constraint character_gallery_character_id_campaign_fk
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id)
  deferrable initially deferred;
alter table public.character_private_fields add constraint character_private_fields_character_id_campaign_fk
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_entry_images add constraint campaign_entry_images_creature_id_campaign_fk
  foreign key (campaign_id,creature_id) references public.creatures(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_entry_images add constraint campaign_entry_images_ally_id_campaign_fk
  foreign key (campaign_id,ally_id) references public.allies(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_entry_images add constraint campaign_entry_images_organization_id_campaign_fk
  foreign key (campaign_id,organization_id) references public.organizations(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_entry_private_fields add constraint campaign_entry_private_fields_creature_id_campaign_fk
  foreign key (campaign_id,creature_id) references public.creatures(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_entry_private_fields add constraint campaign_entry_private_fields_ally_id_campaign_fk
  foreign key (campaign_id,ally_id) references public.allies(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_entry_private_fields add constraint campaign_entry_private_fields_organization_id_campaign_fk
  foreign key (campaign_id,organization_id) references public.organizations(campaign_id,id)
  deferrable initially deferred;
alter table public.inventory_group_members add constraint inventory_group_members_group_id_campaign_fk
  foreign key (campaign_id,group_id) references public.inventory_groups(campaign_id,id)
  deferrable initially deferred;
alter table public.inventory_group_contributions add constraint inventory_group_contributions_group_id_campaign_fk
  foreign key (campaign_id,group_id) references public.inventory_groups(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_comments add constraint campaign_comments_map_id_campaign_fk
  foreign key (campaign_id,map_id) references public.maps(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_comments add constraint campaign_comments_character_id_campaign_fk
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_comments add constraint campaign_comments_creature_id_campaign_fk
  foreign key (campaign_id,creature_id) references public.creatures(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_comments add constraint campaign_comments_ally_id_campaign_fk
  foreign key (campaign_id,ally_id) references public.allies(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_comments add constraint campaign_comments_organization_id_campaign_fk
  foreign key (campaign_id,organization_id) references public.organizations(campaign_id,id)
  deferrable initially deferred;
alter table public.campaign_comments add constraint campaign_comments_author_character_id_campaign_fk
  foreign key (campaign_id,author_character_id) references public.characters(campaign_id,id)
  deferrable initially deferred;

alter table public.resources drop constraint resources_name_key;
alter table public.resources add unique (campaign_id,name);
drop index public.inventory_groups_name_unique;
create unique index inventory_groups_name_unique on public.inventory_groups(campaign_id,lower(btrim(name)));

alter policy characters_global_admin_read on public.characters
using ((select campaign_private.is_campaign_director(campaign_private.selected_campaign())));
alter policy character_diary_global_admin_read on public.character_diary
using ((select campaign_private.is_campaign_director(campaign_private.selected_campaign())));
alter policy gallery_global_admin_read on public.character_gallery
using ((select campaign_private.is_campaign_director(campaign_private.selected_campaign())));

-- The previous SECURITY DEFINER directories bypass RLS and must explicitly scope their rows.
create or replace function campaign_private.list_character_companions()
returns table (id integer, name varchar, race varchar, character_class varchar,
               level integer, emoji text, owner_name varchar)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, c.race, c.character_class, c.level, c.emoji, p.username
  from public.characters c
  join public.profiles p on p.id = c.user_id
  where c.campaign_id = (select campaign_private.selected_campaign())
    and (select auth.uid()) is not null
    and c.user_id <> (select auth.uid())
    and (select campaign_private.permitted('characters', 1));
$$;

create or replace function campaign_private.list_shared_character_sheets()
returns table (
  id integer, name varchar, race varchar, character_class varchar, level integer,
  emoji text, owner_name varchar, background text, equipment text, abilities text,
  appearance text, personality text, goals text, notes text
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, c.race, c.character_class, c.level, c.emoji, p.username,
         c.background, c.equipment, c.abilities, c.appearance, c.personality, c.goals, c.notes
  from public.characters c join public.profiles p on p.id = c.user_id
  where c.campaign_id = (select campaign_private.selected_campaign())
    and (select auth.uid()) is not null and c.user_id <> (select auth.uid())
    and (select campaign_private.permitted('characters', 1));
$$;

grant update (name,description,theme,accent,cover_path,emblem_path) on public.campaigns to authenticated;
create policy campaigns_director_update on public.campaigns for update to authenticated
using (campaign_private.is_campaign_director(id)) with check (campaign_private.is_campaign_director(id));

create function campaign_private.add_member(target_campaign uuid, target_user uuid, director boolean) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.campaign_members (campaign_id,user_id,is_director)
  values (target_campaign,target_user,director) on conflict do nothing;
  insert into public.page_permissions (campaign_id,user_id,page_key,permission_level)
  select target_campaign,target_user,d.page_key,d.level
  from (values ('tracker','view'),('characters','edit'),('bestiary','view'),
    ('organizations','view'),('npcs','view'),('admin','none')) d(page_key,level)
  on conflict do nothing;
end;
$$;
revoke all on function campaign_private.add_member(uuid,uuid,boolean) from public, anon, authenticated;
-- Recover any missing legacy section rows without changing existing permission choices.
select campaign_private.add_member(campaign_id,user_id,is_director) from public.campaign_members;


create function campaign_private.manage_campaign(action text, payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target_campaign uuid := campaign_private.selected_campaign();
  target_user uuid;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  if action = 'create' then
    insert into public.campaigns(name) values (btrim(payload ->> 'name')) returning id into target_campaign;
    perform campaign_private.add_member(target_campaign,actor,true);
    return to_jsonb(target_campaign);
  end if;

  if action = 'self' then
    select jsonb_build_object('id', p.id, 'username', p.username, 'is_admin', m.is_director,
      'permissions', (select coalesce(jsonb_agg(jsonb_build_object('page_key', a.page_key,
        'permission_level', case when m.is_director then 'admin' else a.permission_level end)), '[]'::jsonb)
        from public.page_permissions a where a.user_id = m.user_id and a.campaign_id = m.campaign_id))
    into result from public.campaign_members m join public.profiles p on p.id = m.user_id
    where m.campaign_id = target_campaign and m.user_id = actor;
    return result;
  end if;

  if not campaign_private.permitted_in(target_campaign,'admin',3) then
    raise exception 'Campaign administration required' using errcode = '42501';
  end if;

  if action = 'roster' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username,
      'is_admin', m.is_director, 'permissions', (select coalesce(jsonb_agg(jsonb_build_object(
        'page_key', a.page_key, 'permission_level',
        case when m.is_director then 'admin' else a.permission_level end)), '[]'::jsonb)
        from public.page_permissions a where a.user_id = m.user_id and a.campaign_id = m.campaign_id))
      order by lower(p.username)), '[]'::jsonb)
      from public.campaign_members m join public.profiles p on p.id = m.user_id
      where m.campaign_id = target_campaign);
  end if;

  if action = 'invite' then
    select id into target_user from public.profiles where lower(username) = lower(btrim(payload ->> 'username'));
    if target_user is null then raise exception 'Account not found'; end if;
    perform campaign_private.add_member(target_campaign,target_user,false);
    return null;
  end if;

  target_user := (payload ->> 'userId')::uuid;
  if not exists (select 1 from public.campaign_members m where m.campaign_id = target_campaign
    and m.user_id = target_user and not m.is_director) then
    raise exception 'Member not editable' using errcode = '42501';
  end if;
  if action = 'remove' then
    if target_user = actor then raise exception 'Cannot remove your own membership'; end if;
    delete from public.campaign_members where campaign_id = target_campaign and user_id = target_user and not is_director;
    return null;
  end if;
  if action = 'permission' then
    if target_user = actor and payload ->> 'pageKey' = 'admin' then
      raise exception 'Cannot change your own administration permission';
    end if;
    update public.page_permissions p set permission_level = payload ->> 'permission_level'
    where p.campaign_id = target_campaign and p.user_id = target_user and p.page_key = payload ->> 'pageKey'
    returning jsonb_build_object('page_key',p.page_key,'permission_level',p.permission_level) into result;
    if result is null then raise exception 'Permission not found'; end if;
    return result;
  end if;
  raise exception 'Unknown action';
end;
$$;
revoke all on function campaign_private.manage_campaign(text,jsonb) from public, anon, authenticated;
grant execute on function campaign_private.manage_campaign(text,jsonb) to authenticated;

create function public.manage_campaign(action text, payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = ''
as $$ select campaign_private.manage_campaign(action,payload); $$;
revoke all on function public.manage_campaign(text,jsonb) from public, anon, authenticated;
grant execute on function public.manage_campaign(text,jsonb) to authenticated;

revoke select on public.profiles from authenticated;
grant select (id,username,created_at) on public.profiles to authenticated;
