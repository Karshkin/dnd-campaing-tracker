create table public.campaign_comments (
  id integer generated always as identity primary key,
  map_id integer references public.maps(id) on delete cascade,
  character_id integer references public.characters(id) on delete cascade,
  creature_id integer references public.creatures(id) on delete cascade,
  ally_id integer references public.allies(id) on delete cascade,
  organization_id integer references public.organizations(id) on delete cascade,
  author_character_id integer references public.characters(id) on delete set null,
  author_name text not null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  section text generated always as (
    case when map_id is not null then 'tracker'
         when character_id is not null then 'characters'
         when creature_id is not null then 'bestiary'
         when ally_id is not null then 'npcs'
         else 'organizations' end
  ) stored,
  check (num_nonnulls(map_id, character_id, creature_id, ally_id, organization_id) = 1)
);

create index campaign_comments_map_idx on public.campaign_comments (map_id, id) where map_id is not null;
create index campaign_comments_character_idx on public.campaign_comments (character_id, id) where character_id is not null;
create index campaign_comments_creature_idx on public.campaign_comments (creature_id, id) where creature_id is not null;
create index campaign_comments_ally_idx on public.campaign_comments (ally_id, id) where ally_id is not null;
create index campaign_comments_org_idx on public.campaign_comments (organization_id, id) where organization_id is not null;
create index campaign_comments_author_idx on public.campaign_comments (author_character_id) where author_character_id is not null;

create function campaign_private.set_campaign_comment_author()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  select c.name into new.author_name
  from public.characters c
  where c.id = new.author_character_id and c.user_id = (select auth.uid());

  if not found then raise exception 'Select your own character' using errcode = '42501'; end if;
  return new;
end;
$$;
revoke all on function campaign_private.set_campaign_comment_author() from public, anon, authenticated;
create trigger campaign_comments_author before insert on public.campaign_comments
for each row execute function campaign_private.set_campaign_comment_author();

alter table public.campaign_comments enable row level security;
revoke all on public.campaign_comments from public, anon, authenticated;

grant select (id, map_id, character_id, creature_id, ally_id, organization_id, author_name, body, created_at),
      insert (map_id, character_id, creature_id, ally_id, organization_id, author_character_id, body)
on public.campaign_comments to authenticated;
grant usage on sequence public.campaign_comments_id_seq to authenticated;

create policy campaign_comments_read on public.campaign_comments for select to authenticated
using (
  campaign_private.permitted(section, 1)
  and (map_id is null or exists (select 1 from public.maps m where m.id = map_id and m.is_active))
);

create policy campaign_comments_add on public.campaign_comments for insert to authenticated
with check (
  campaign_private.permitted(section, 1)
  and (map_id is null or exists (select 1 from public.maps m where m.id = map_id and m.is_active))
  and exists (select 1 from public.characters c
    where c.id = author_character_id and c.user_id = (select auth.uid()))
);
