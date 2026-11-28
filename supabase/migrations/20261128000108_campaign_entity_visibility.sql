-- Entries without an explicit rule retain their existing visibility and permissions.
create table campaign_private.visibility_entities (
  kind text primary key,
  relation regclass not null unique
);
alter table campaign_private.visibility_entities enable row level security;
revoke all on campaign_private.visibility_entities from public,anon,authenticated;

insert into campaign_private.visibility_entities(kind,relation) values
  ('allies','public.allies'), ('creatures','public.creatures'), ('organizations','public.organizations'),
  ('points_of_interest','public.points_of_interest'), ('map_events','public.map_events'),
  ('chronicle_quests','public.chronicle_quests'), ('maps','public.maps');

create table campaign_private.entity_visibility (
  campaign_id uuid not null references public.campaigns on delete cascade,
  kind text not null references campaign_private.visibility_entities(kind),
  entity_id text not null,
  audience text not null check (audience in ('hidden','individual')),
  characters integer[] not null default '{}',
  primary key(campaign_id,kind,entity_id),
  check (audience = 'individual' or cardinality(characters) = 0)
);
alter table campaign_private.entity_visibility enable row level security;
revoke all on campaign_private.entity_visibility from public,anon,authenticated;

create function campaign_private.can_discover(c uuid, entity_kind text, target text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and campaign_private.is_campaign_member(c) and (
    campaign_private.is_campaign_director(c) or not exists (
      select 1 from campaign_private.entity_visibility v
      where (v.campaign_id,v.kind,v.entity_id) = (c,entity_kind,target)
        and (v.audience = 'hidden' or not exists (
          select 1 from public.characters ch
          where ch.campaign_id = c and ch.user_id = auth.uid() and ch.id = any(v.characters)
        ))
    )
  );
$$;
revoke all on function campaign_private.can_discover(uuid,text,text) from public,anon,authenticated;
grant execute on function campaign_private.can_discover(uuid,text,text) to authenticated;

create function campaign_private.manage_visibility(entity_kind text, target text, visibility text, recipients integer[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare c uuid := campaign_private.selected_campaign();
declare table_name regclass;
declare found_entry boolean;
declare allowed_count integer;
begin
  if auth.uid() is null or not campaign_private.is_campaign_director(c) then raise exception 'Se requiere permiso de director'; end if;
  select relation into strict table_name from campaign_private.visibility_entities where kind = entity_kind;
  execute format('select exists (select 1 from %s where campaign_id = $1 and id::text = $2)',table_name)
    into found_entry using c,target;
  if not found_entry then raise exception 'La entidad no está disponible en esta campaña'; end if;

  if visibility is not null then
    if visibility = 'discovered' then
      delete from campaign_private.entity_visibility where (campaign_id,kind,entity_id) = (c,entity_kind,target);
    else
      recipients := coalesce(recipients,'{}');
      if visibility = 'individual' then
        select count(*) into allowed_count from public.characters where campaign_id = c and id = any(recipients);
        if allowed_count <> cardinality(recipients) or allowed_count not between 1 and 100 then
          raise exception 'Selecciona personajes de esta campaña sin duplicados';
        end if;
      elsif visibility = 'hidden' then
        recipients := '{}';
      else
        raise exception 'Visibilidad desconocida';
      end if;
      insert into campaign_private.entity_visibility(campaign_id,kind,entity_id,audience,characters)
      values(c,entity_kind,target,visibility,recipients)
      on conflict (campaign_id,kind,entity_id) do update set audience = excluded.audience, characters = excluded.characters;
    end if;
  end if;
  return coalesce((
    select jsonb_build_object('visibility',audience,'recipients',characters)
    from campaign_private.entity_visibility where (campaign_id,kind,entity_id) = (c,entity_kind,target)
  ),'{"visibility":"discovered","recipients":[]}'::jsonb);
end;
$$;
revoke all on function campaign_private.manage_visibility(text,text,text,integer[]) from public,anon,authenticated;
grant execute on function campaign_private.manage_visibility(text,text,text,integer[]) to authenticated;

create function public.manage_visibility(entity_kind text, target text, visibility text default null, recipients integer[] default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select campaign_private.manage_visibility(entity_kind,target,visibility,recipients); $$;
revoke all on function public.manage_visibility(text,text,text,integer[]) from public,anon,authenticated;
grant execute on function public.manage_visibility(text,text,text,integer[]) to authenticated;

do $$
declare entry record;
declare operation text;
begin
  for entry in select kind,relation from campaign_private.visibility_entities loop
    foreach operation in array array['select','update','delete'] loop
      execute format('create policy discovery_%s on %s as restrictive for %s to authenticated
        using (campaign_private.can_discover(campaign_id,%L,id::text))',operation,entry.relation,operation,entry.kind);
    end loop;
  end loop;
end $$;

create policy map_parent_discovery on public.points_of_interest as restrictive for select to authenticated
using (campaign_private.can_discover(campaign_id,'maps',map_id::text));
create policy event_map_discovery on public.map_events as restrictive for select to authenticated
using (campaign_private.can_discover(campaign_id,'maps',map_id::text));

create policy comment_discovery on public.campaign_comments as restrictive for select to authenticated
using (
  campaign_private.can_discover(campaign_id,'maps',map_id::text)
  and campaign_private.can_discover(campaign_id,'allies',ally_id::text)
  and campaign_private.can_discover(campaign_id,'creatures',creature_id::text)
  and campaign_private.can_discover(campaign_id,'organizations',organization_id::text)
);
create policy comment_discovery_write on public.campaign_comments as restrictive for insert to authenticated
with check (
  campaign_private.can_discover(campaign_id,'maps',map_id::text)
  and campaign_private.can_discover(campaign_id,'allies',ally_id::text)
  and campaign_private.can_discover(campaign_id,'creatures',creature_id::text)
  and campaign_private.can_discover(campaign_id,'organizations',organization_id::text)
);
create policy linked_entity_discovery on public.chronicle_links as restrictive for select to authenticated
using (
  campaign_private.can_discover(campaign_id,'allies',npc_id::text)
  and campaign_private.can_discover(campaign_id,'creatures',creature_id::text)
  and campaign_private.can_discover(campaign_id,'organizations',organization_id::text)
  and campaign_private.can_discover(campaign_id,'points_of_interest',place_id::text)
);
create policy faction_discovery on public.faction_reputation as restrictive for select to authenticated
using (campaign_private.can_discover(campaign_id,'organizations',organization_id::text));

do $$
declare relation text;
begin
  foreach relation in array array['campaign_entry_images','campaign_entry_private_fields'] loop
    execute format('create policy entry_discovery on public.%I as restrictive for select to authenticated
      using (campaign_private.can_discover(campaign_id,''allies'',ally_id::text)
        and campaign_private.can_discover(campaign_id,''creatures'',creature_id::text)
        and campaign_private.can_discover(campaign_id,''organizations'',organization_id::text))',relation);
  end loop;
end $$;

create function campaign_private.can_discover_asset(bucket text, path text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare relation text := split_part(path,'/',1);
declare target text := split_part(path,'/',2);
declare c uuid;
declare map_parent integer;
begin
  if bucket = 'campaign-entry-images' then
    relation := case relation when 'npcs' then 'allies' when 'bestiary' then 'creatures' when 'organizations' then 'organizations' end;
  elsif bucket <> 'campaign-files' or relation not in ('allies','creatures','organizations','maps','points_of_interest','map_events') then
    return true;
  end if;
  if target !~ '^[1-9][0-9]{0,9}$' or target::bigint > 2147483647 then return false; end if;
  select campaign_id into c from campaign_private.asset_parents where relation_name = relation and entry_id = target::integer;
  if not found or not campaign_private.can_discover(c,relation,target) then return false; end if;
  if relation = 'points_of_interest' then
    select map_id into map_parent from public.points_of_interest where id = target::integer;
  elsif relation = 'map_events' then
    select map_id into map_parent from public.map_events where id = target::integer;
  end if;
  return map_parent is null or campaign_private.can_discover(c,'maps',map_parent::text);
end;
$$;
revoke all on function campaign_private.can_discover_asset(text,text) from public,anon,authenticated;
grant execute on function campaign_private.can_discover_asset(text,text) to authenticated;
create policy asset_discovery on storage.objects as restrictive for select to authenticated
using (campaign_private.can_discover_asset(bucket_id,name));
