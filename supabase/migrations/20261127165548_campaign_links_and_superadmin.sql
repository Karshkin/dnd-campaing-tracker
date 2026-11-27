-- UUIDs remain the database keys. Only slugs are used in new public links.
alter table public.campaigns add column slug text unique
  check (length(slug) between 1 and 64 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Keep retired links reserved to their original campaign, so an old shared
-- registration URL can never admit a player to a different campaign.
create table campaign_private.campaign_link_history (
  slug text primary key,
  campaign_id uuid not null
);
revoke all on campaign_private.campaign_link_history from public, anon, authenticated;

create function campaign_private.available_campaign_slug(campaign_name text) returns text
language plpgsql set search_path = ''
as $$
declare
  base text := trim(both '-' from left(regexp_replace(
    translate(lower(campaign_name), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', '-', 'g'), 64));
  candidate text;
begin
  base := coalesce(nullif(base, ''), 'campaign');
  -- Serialize generation for names that normalize to the same slug.
  perform pg_advisory_xact_lock(hashtextextended(base, 0));
  candidate := base;
  while exists (select 1 from public.campaigns where slug = candidate)
     or exists (select 1 from campaign_private.campaign_link_history where slug = candidate) loop
    candidate := rtrim(left(base, 55), '-') || '-' || left(gen_random_uuid()::text, 8);
  end loop;
  return candidate;
end;
$$;
revoke all on function campaign_private.available_campaign_slug(text) from public, anon, authenticated;

create function campaign_private.default_campaign_slug() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.slug is null then new.slug := campaign_private.available_campaign_slug(new.name); end if;
  return new;
end;
$$;
revoke all on function campaign_private.default_campaign_slug() from public, anon, authenticated;
create trigger campaign_slug_before_insert before insert on public.campaigns
for each row execute function campaign_private.default_campaign_slug();

do $$
declare
  campaign record;
begin
  for campaign in select id, name from public.campaigns
    order by (id = '00000000-0000-4000-8000-000000000001') desc, id
  loop
    update public.campaigns set slug = campaign_private.available_campaign_slug(campaign.name) where id = campaign.id;
  end loop;
end;
$$;
alter table public.campaigns alter column slug set not null;
grant update (slug) on public.campaigns to authenticated;

insert into campaign_private.campaign_link_history(slug, campaign_id)
select slug, id from public.campaigns;

create function campaign_private.reserve_campaign_slug() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into campaign_private.campaign_link_history as history (slug, campaign_id)
  values (new.slug, new.id)
  on conflict (slug) do update set campaign_id = excluded.campaign_id
    where history.campaign_id = excluded.campaign_id;
  if not found then raise exception 'Campaign link is already reserved' using errcode = '23505'; end if;
  return new;
end;
$$;
revoke all on function campaign_private.reserve_campaign_slug() from public, anon, authenticated;
create trigger campaign_slug_after_insert_or_update after insert or update of slug on public.campaigns
for each row execute function campaign_private.reserve_campaign_slug();

-- The old installation-wide administrator flag is writable only by operators.
create function campaign_private.is_superadmin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin);
$$;
revoke all on function campaign_private.is_superadmin() from public, anon, authenticated;

create or replace function campaign_private.selected_campaign() returns uuid
language sql stable security definer set search_path = ''
as $$
  select case
    when ref is null then '00000000-0000-4000-8000-000000000001'::uuid
    when ref ~ '^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$' then ref::uuid
    else (select c.id from public.campaigns c where c.slug = ref)
  end
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-campaign-id' as ref) r;
$$;

create or replace function campaign_private.is_campaign_member(target_campaign uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select ((select campaign_private.is_superadmin()) and exists(select 1 from public.campaigns where id = target_campaign))
    or exists(select 1 from public.campaign_members m where m.campaign_id = target_campaign and m.user_id = (select auth.uid()));
$$;

create or replace function campaign_private.is_campaign_director(target_campaign uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select ((select campaign_private.is_superadmin()) and exists(select 1 from public.campaigns where id = target_campaign))
    or exists(select 1 from public.campaign_members m where m.campaign_id = target_campaign
      and m.user_id = (select auth.uid()) and m.is_director);
$$;

create or replace function campaign_private.permitted_in(target_campaign uuid, section text, minimum integer) returns boolean
language sql stable security definer set search_path = ''
as $$
  select campaign_private.is_campaign_director(target_campaign) or coalesce((
    select coalesce(case p.permission_level when 'admin' then 3 when 'edit' then 2 when 'view' then 1 else 0 end, 0) >= minimum
    from public.campaign_members m
    left join public.page_permissions p
      on p.campaign_id = m.campaign_id and p.user_id = m.user_id and p.page_key = section
    where m.campaign_id = target_campaign and m.user_id = (select auth.uid())
  ), false);
$$;

-- Only account creation consumes this public registration link. Editing Auth
-- metadata or signing into an existing account cannot add a membership.
create or replace function campaign_private.create_profile() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  signup_slug text := nullif(new.raw_user_meta_data ->> 'campaign_slug', '');
  target uuid;
begin
  insert into public.profiles(id,username)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), 'player-' || new.id::text));
  if signup_slug is not null then
    select c.id into target from public.campaigns c where c.slug = signup_slug for share;
    if target is null then
      raise exception 'Campaign registration link is invalid' using errcode = '22023';
    end if;
    perform campaign_private.add_member(target, new.id, false);
  end if;
  return new;
end;
$$;

-- Public links grant only signup for their current slug. The preview returns
-- only the corresponding name, for the signed-out registration form.
create function public.registration_campaign(link_slug text) returns text
language sql stable security definer set search_path = ''
as $$ select name from public.campaigns where slug = link_slug; $$;
revoke all on function public.registration_campaign(text) from public, anon, authenticated;
grant execute on function public.registration_campaign(text) to anon, authenticated;

alter function campaign_private.manage_campaign(text,jsonb) rename to manage_campaign_members;
revoke all on function campaign_private.manage_campaign_members(text,jsonb) from public, anon, authenticated;

create function campaign_private.manage_campaign(action text, payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  elevated boolean := campaign_private.is_superadmin();
  target uuid := campaign_private.selected_campaign();
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  if action = 'directory' then
    return jsonb_build_object('is_superadmin', elevated, 'campaigns', (
      select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('is_director', elevated or m.is_director)
        order by lower(c.name), c.id), '[]'::jsonb)
      from public.campaigns c
      left join public.campaign_members m on m.campaign_id = c.id and m.user_id = actor
      where elevated or m.user_id is not null
    ));
  end if;

  if action = 'create' and not elevated then
    raise exception 'Superadmin required to create a campaign' using errcode = '42501';
  end if;

  if action = 'self' and elevated then
    if not exists (select 1 from public.campaigns where id = target) then return null; end if;
    return (select jsonb_build_object('id', p.id, 'username', p.username, 'is_admin', true,
      'is_superadmin', true, 'permissions', (
        select jsonb_agg(jsonb_build_object('page_key', section, 'permission_level', 'admin'))
        from unnest(array['tracker','characters','bestiary','organizations','npcs','admin']) as sections(section)
      )) from public.profiles p where p.id = actor);
  end if;

  if action = 'director' then
    if not elevated then raise exception 'Superadmin required to manage administrators' using errcode = '42501'; end if;
    update public.campaign_members
      set is_director = (payload ->> 'director')::boolean
      where campaign_id = target and user_id = (payload ->> 'userId')::uuid;
    if not found then raise exception 'Campaign member not found'; end if;
    return null;
  end if;

  result := campaign_private.manage_campaign_members(action, payload);
  return result;
end;
$$;
revoke all on function campaign_private.manage_campaign(text,jsonb) from public, anon, authenticated;
grant execute on function campaign_private.manage_campaign(text,jsonb) to authenticated;

create or replace function public.manage_campaign(action text, payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = ''
as $$ select campaign_private.manage_campaign(action,payload); $$;
