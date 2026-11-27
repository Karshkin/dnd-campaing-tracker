create table public.campaign_entry_private_fields (
  id integer generated always as identity primary key,
  creature_id integer unique references public.creatures(id) on delete cascade,
  ally_id integer unique references public.allies(id) on delete cascade,
  organization_id integer unique references public.organizations(id) on delete cascade,
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  entry_section text generated always as (
    case when creature_id is not null then 'bestiary'
         when ally_id is not null then 'npcs' else 'organizations' end
  ) stored,
  check (num_nonnulls(creature_id, ally_id, organization_id) = 1),
  check ((fields - case
    when creature_id is not null then array['creature_type','challenge_rating','armor_class','hit_points','speed','abilities','weaknesses','resistances','immunities','notes']
    when ally_id is not null then array['role','location','relationship','notes']
    else array['description']
  end) = '{}'::jsonb),
  check (not jsonb_path_exists(fields - 'armor_class', '$.* ? (@.type() != "string")')),
  check (not (fields ? 'armor_class') or jsonb_typeof(fields -> 'armor_class') = 'number')
);

alter table public.campaign_entry_private_fields enable row level security;
revoke all on public.campaign_entry_private_fields from public, anon, authenticated;
grant select, insert (creature_id, ally_id, organization_id, fields), update (fields)
on public.campaign_entry_private_fields to authenticated;
grant usage on sequence public.campaign_entry_private_fields_id_seq to authenticated;

create policy campaign_entry_private_fields_editors on public.campaign_entry_private_fields
for all to authenticated
using (campaign_private.permitted(entry_section, 2))
with check (campaign_private.permitted(entry_section, 2));

-- Keep the shared row and the editor-only values in sync in one transaction.
create function public.save_campaign_entry(collection text, target_id integer, draft jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  parent_column text;
  section text;
  public_fields text[];
  sensitive_fields text[];
  private_values jsonb;
  existing_private jsonb;
  shared_draft jsonb;
  result jsonb;
  columns text;
  fields_sql text;
begin
  case collection
    when 'creatures' then
      parent_column := 'creature_id';
      section := 'bestiary';
      public_fields := array['name', 'creature_type', 'challenge_rating', 'armor_class', 'hit_points', 'speed', 'abilities', 'weaknesses', 'resistances', 'immunities', 'notes'];
      sensitive_fields := array['creature_type', 'challenge_rating', 'armor_class', 'hit_points', 'speed', 'abilities', 'weaknesses', 'resistances', 'immunities', 'notes'];
    when 'allies' then
      parent_column := 'ally_id';
      section := 'npcs';
      public_fields := array['name', 'role', 'location', 'relationship', 'notes', 'alignment', 'organization_id'];
      sensitive_fields := array['role', 'location', 'relationship', 'notes'];
    when 'organizations' then
      parent_column := 'organization_id';
      section := 'organizations';
      public_fields := array['name', 'description'];
      sensitive_fields := array['description'];
    else raise exception 'Unknown entry type';
  end case;
  if not campaign_private.permitted(section, 2) then
    raise exception 'Entry not editable' using errcode = '42501';
  end if;
  if draft is null or jsonb_typeof(draft) <> 'object'
    or jsonb_typeof(coalesce(draft -> 'private_fields', '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid entry';
  end if;

  select coalesce(jsonb_object_agg(key, draft -> key), '{}'::jsonb)
    into private_values
  from jsonb_array_elements_text(coalesce(draft -> 'private_fields', '[]'::jsonb)) selected(key)
  where key = any(sensitive_fields) and draft ? key;

  if target_id is not null then
    execute format('select to_jsonb(entry) from public.%I entry where id = $1 for update', collection)
      using target_id into result;
    if result is null then raise exception 'Entry not editable' using errcode = '42501'; end if;

    execute format('select fields from public.campaign_entry_private_fields where %I = $1', parent_column)
      using target_id into existing_private;
    private_values := (coalesce(existing_private, '{}'::jsonb) -
      array(select jsonb_object_keys(draft))) || private_values;
  end if;

  select coalesce(jsonb_object_agg(key, case
    when private_values ? key then case when key = 'armor_class' then '0'::jsonb else '""'::jsonb end
    else val end), '{}'::jsonb)
  into shared_draft
  from jsonb_each(draft) f(key, val) where key = any(public_fields);

  select string_agg(format('%I', key), ', ' order by key), string_agg(format('p.%I', key), ', ' order by key)
  into columns, fields_sql from jsonb_object_keys(shared_draft) key;
  if columns is null then raise exception 'Entry has no fields'; end if;

  if target_id is null then
    execute format('insert into public.%I as entry (%s) select %s
      from jsonb_populate_record(null::public.%I, $1) p returning to_jsonb(entry)',
      collection, columns, fields_sql, collection)
      using shared_draft into result;
  else
    execute format('update public.%I as entry set (%s) = (select %s
      from jsonb_populate_record(null::public.%I, $1) p)
      where entry.id = $2 returning to_jsonb(entry)',
      collection, columns, fields_sql, collection)
      using shared_draft, target_id into result;
  end if;
  if result is null then raise exception 'Entry not editable' using errcode = '42501'; end if;

  execute format('insert into public.campaign_entry_private_fields (%I, fields)
    values ($1, $2) on conflict (%I) do update set fields = excluded.fields',
    parent_column, parent_column)
    using (result ->> 'id')::integer, private_values;
  return result;
end;
$$;
revoke all on function public.save_campaign_entry(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_campaign_entry(text, integer, jsonb) to authenticated;
