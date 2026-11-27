create table public.character_private_fields (
  character_id integer primary key references public.characters(id) on delete cascade,
  fields jsonb not null check (
    jsonb_typeof(fields) = 'object'
    and (fields - array['background','equipment','abilities','appearance','personality','goals','notes','nivel20_url']) = '{}'::jsonb
    and not jsonb_path_exists(fields, '$.* ? (@.type() != "string")')
  )
);
alter table public.character_private_fields enable row level security;
revoke all on public.character_private_fields from public, anon, authenticated;
grant select, insert (character_id, fields), update (fields) on public.character_private_fields to authenticated;

create policy character_private_fields_owner_read on public.character_private_fields
for select to authenticated
using (exists (select 1 from public.characters c
  where c.id = character_id and c.user_id = (select auth.uid())));

create policy character_private_fields_owner_insert on public.character_private_fields
for insert to authenticated
with check ((select campaign_private.permitted('characters', 2)) and exists (
  select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid())
));

create policy character_private_fields_owner_update on public.character_private_fields
for update to authenticated
using ((select campaign_private.permitted('characters', 2)) and exists (
  select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid())
))
with check ((select campaign_private.permitted('characters', 2)) and exists (
  select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid())
));

-- Write both representations in the same transaction. Shared rows contain blanks
-- for private fields, so existing readers and database policies never expose them.
create function public.save_character_profile(target_id integer, draft jsonb)
returns public.characters
language plpgsql security invoker set search_path = ''
as $$
declare
  profile public.characters;
  private_values jsonb;
  allowed_fields constant text[] := array['background', 'equipment', 'abilities', 'appearance', 'personality', 'goals', 'notes', 'nivel20_url'];
begin
  if draft is null or jsonb_typeof(draft) <> 'object'
    or jsonb_typeof(coalesce(draft -> 'private_fields', '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid character sheet';
  end if;

  if target_id is not null then
    select * into profile from public.characters c where c.id = target_id and c.user_id = (select auth.uid());
    if not found then raise exception 'Character not found'; end if;
  end if;

  select coalesce(jsonb_object_agg(field, coalesce(draft ->> field, '')), '{}'::jsonb)
    into private_values
  from jsonb_array_elements_text(coalesce(draft -> 'private_fields', '[]'::jsonb)) chosen(field)
  where field = any(allowed_fields);

  if exists (select 1 from jsonb_each_text(private_values) f where
    (f.key <> 'nivel20_url' and length(f.value) > 4000)
    or (f.key = 'nivel20_url' and (length(f.value) > 2048 or (f.value <> ''
      and f.value !~ '^https://(www\.)?nivel20\.com/[A-Za-z0-9][^[:space:][:cntrl:]]*$')))
  ) then
    raise exception 'Invalid private field';
  end if;

  profile := jsonb_populate_record(profile, draft - array(select jsonb_object_keys(private_values)));
  if private_values ? 'background' then profile.background := ''; end if;
  if private_values ? 'equipment' then profile.equipment := ''; end if;
  if private_values ? 'abilities' then profile.abilities := ''; end if;
  if private_values ? 'appearance' then profile.appearance := ''; end if;
  if private_values ? 'personality' then profile.personality := ''; end if;
  if private_values ? 'goals' then profile.goals := ''; end if;
  if private_values ? 'notes' then profile.notes := ''; end if;
  if private_values ? 'nivel20_url' then profile.nivel20_url := ''; end if;

  if target_id is null then
    insert into public.characters (name, character_class, level, race, organization_id, emoji, background, equipment, abilities, appearance, personality, goals, notes, nivel20_url)
    values (
      profile.name, coalesce(profile.character_class, ''), coalesce(profile.level, 1),
      coalesce(profile.race, ''), profile.organization_id, coalesce(profile.emoji, ''),
      coalesce(profile.background, ''), coalesce(profile.equipment, ''), coalesce(profile.abilities, ''), coalesce(profile.appearance, ''), coalesce(profile.personality, ''), coalesce(profile.goals, ''), coalesce(profile.notes, ''), coalesce(profile.nivel20_url, '')
    ) returning * into profile;
  else
    update public.characters set
      emoji = profile.emoji,
      background = profile.background,
      equipment = profile.equipment,
      abilities = profile.abilities,
      appearance = profile.appearance,
      personality = profile.personality,
      goals = profile.goals,
      notes = profile.notes,
      nivel20_url = profile.nivel20_url
    where id = target_id and user_id = (select auth.uid()) returning * into profile;
    if not found then raise exception 'Character not editable'; end if;
  end if;

  insert into public.character_private_fields (character_id, fields) values (profile.id, private_values)
  on conflict (character_id) do update set fields = excluded.fields;

  return profile;
end;
$$;
revoke all on function public.save_character_profile(integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_character_profile(integer, jsonb) to authenticated;

-- Companions receive shared sheet fields only, with no links, images or diary.
create function campaign_private.list_shared_character_sheets()
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
  where (select auth.uid()) is not null and c.user_id <> (select auth.uid())
    and (select campaign_private.permitted('characters', 1));
$$;

revoke all on function campaign_private.list_shared_character_sheets() from public, anon, authenticated;
grant execute on function campaign_private.list_shared_character_sheets() to authenticated;

create function public.list_shared_character_sheets()
returns table (
  id integer, name varchar, race varchar, character_class varchar, level integer,
  emoji text, owner_name varchar, background text, equipment text, abilities text,
  appearance text, personality text, goals text, notes text
)
language sql stable security invoker set search_path = ''
as $$ select * from campaign_private.list_shared_character_sheets(); $$;

revoke all on function public.list_shared_character_sheets() from public, anon, authenticated;
grant execute on function public.list_shared_character_sheets() to authenticated;
