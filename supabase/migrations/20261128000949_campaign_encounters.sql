create table public.encounters (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 120),
 session_id uuid,
 place_id integer,
 phase text not null default 'prepared' check(phase in ('prepared','running','completed')),
 round integer not null default 0 check(round >= 0),
 turn_id uuid,
 revision integer not null default 0,
 experience integer not null default 0 check(experience >= 0),
 rewards text not null default '',
 unique(campaign_id,id),
 foreign key(campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete set null(session_id),
 foreign key(campaign_id,place_id) references public.points_of_interest(campaign_id,id) on delete set null(place_id)
);
create table public.encounter_combatants (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null default campaign_private.selected_campaign(),
 encounter_id uuid not null,
 name text not null check(length(btrim(name)) between 1 and 120),
 creature_id integer,
 character_id integer,
 initiative integer not null default 0,
 maximum_hp integer not null check(maximum_hp between 1 and 1000000),
 hp integer not null check(hp between 0 and maximum_hp),
 temporary_hp integer not null default 0 check(temporary_hp between 0 and 1000000),
 experience integer not null default 0 check(experience >= 0),
 conditions text[] not null default '{}',
 notes text not null default '',
 player_visible boolean not null default true,
 check(num_nonnulls(creature_id,character_id) <= 1),
 foreign key(campaign_id,encounter_id) references public.encounters(campaign_id,id) on delete cascade,
 foreign key(campaign_id,creature_id) references public.creatures(campaign_id,id) on delete set null(creature_id),
 foreign key(campaign_id,character_id) references public.characters(campaign_id,id) on delete set null(character_id)
);
create index encounter_order on public.encounter_combatants(encounter_id,initiative desc,id);
create index encounters_campaign on public.encounters(campaign_id,phase);
alter table public.encounters enable row level security;
alter table public.encounter_combatants enable row level security;
revoke all on public.encounters,public.encounter_combatants from public,anon,authenticated;
grant select(id,campaign_id,title,session_id,place_id,phase,round,revision,experience,rewards) on public.encounters to authenticated;
grant select on public.encounter_combatants to authenticated;
grant insert(title,session_id,place_id,experience,rewards),update(title,session_id,place_id,experience,rewards) on public.encounters to authenticated;
grant insert(encounter_id,name,creature_id,character_id,initiative,maximum_hp,hp,temporary_hp,experience,conditions,notes,player_visible),
 update(name,initiative,maximum_hp,hp,temporary_hp,experience,conditions,notes,player_visible),delete on public.encounter_combatants to authenticated;
create policy encounter_read on public.encounters for select to authenticated
using(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id));
create policy encounter_insert on public.encounters for insert to authenticated
with check(campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id));
create policy encounter_update on public.encounters for update to authenticated
using(campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id) and phase <> 'completed')
with check(campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id));
create policy combatants_director on public.encounter_combatants for all to authenticated
using(campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id))
with check(campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id));
insert into campaign_private.visibility_entities values ('encounters','public.encounters');

create function campaign_private.combatant_phase() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare phase text;
begin
  select e.phase into phase from public.encounters e where e.id = case when tg_op = 'DELETE' then old.encounter_id else new.encounter_id end for share;
  if phase = 'completed' and auth.uid() is not null then raise exception 'El encuentro está cerrado'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function campaign_private.combatant_phase() from public,anon,authenticated;
create trigger combatants_open before insert or update or delete on public.encounter_combatants
for each row execute function campaign_private.combatant_phase();

create function campaign_private.encounter_visible(c uuid,target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and c=campaign_private.selected_campaign() and exists(
    select 1 from public.encounters e where (e.campaign_id,e.id)=(c,target)
      and (campaign_private.is_campaign_director(c) or (
        e.phase <> 'prepared' and campaign_private.permitted_in(c,'tracker',1)
        and campaign_private.can_discover(c,'encounters',e.id::text)
        and (e.session_id is null or exists(select 1 from public.chronicle_sessions s
          where (s.campaign_id,s.id)=(c,e.session_id) and s.status in ('published','closed')))
        and (e.place_id is null or exists(select 1 from public.points_of_interest p
          where (p.campaign_id,p.id)=(c,e.place_id)
            and campaign_private.can_discover(c,'points_of_interest',p.id::text)
            and (p.map_id is null or campaign_private.can_discover(c,'maps',p.map_id::text))))
      ))
  );
$$;
revoke all on function campaign_private.encounter_visible(uuid,uuid) from public,anon,authenticated;
grant execute on function campaign_private.encounter_visible(uuid,uuid) to authenticated;

create function campaign_private.visible_encounters() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'title',e.title,'phase',e.phase,'round',e.round,'revision',e.revision,
    'experience',case when e.phase='completed' then e.experience end,
    'rewards',case when e.phase='completed' then e.rewards end,
    'session_id',e.session_id,'place_id',e.place_id
  ) order by e.title,e.id),'[]'::jsonb)
  from public.encounters e
  where e.campaign_id=campaign_private.selected_campaign() and campaign_private.encounter_visible(e.campaign_id,e.id);
$$;
revoke all on function campaign_private.visible_encounters() from public,anon,authenticated;
grant execute on function campaign_private.visible_encounters() to authenticated;
create function public.visible_encounters() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select campaign_private.visible_encounters(); $$;
revoke all on function public.visible_encounters() from public,anon,authenticated;
grant execute on function public.visible_encounters() to authenticated;

create function campaign_private.visible_encounter_turns(target uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'initiative',u.initiative,'current',e.turn_id = u.id)
    order by u.initiative desc,u.id),'[]'::jsonb)
  from public.encounters e join public.encounter_combatants u on u.encounter_id = e.id
  where e.id = target and e.campaign_id = campaign_private.selected_campaign()
    and campaign_private.encounter_visible(e.campaign_id,e.id)
    and (u.player_visible or campaign_private.is_campaign_director(e.campaign_id));
$$;
revoke all on function campaign_private.visible_encounter_turns(uuid) from public,anon,authenticated;
grant execute on function campaign_private.visible_encounter_turns(uuid) to authenticated;
create function public.visible_encounter_turns(target uuid) returns jsonb
language sql stable set search_path = '' as $$ select campaign_private.visible_encounter_turns(target); $$;
revoke all on function public.visible_encounter_turns(uuid) from public,anon,authenticated;
grant execute on function public.visible_encounter_turns(uuid) to authenticated;

alter table public.treasury_history add column encounter_id uuid,
add foreign key(campaign_id,encounter_id) references public.encounters(campaign_id,id) on delete set null(encounter_id);
create policy treasury_encounter_visibility on public.treasury_history as restrictive for select to authenticated
using(encounter_id is null or campaign_private.encounter_visible(campaign_id,encounter_id));
create or replace function campaign_private.record_treasury(c uuid, party integer, target integer,
  session uuid, operation text, item text, quantity bigint, coin public.coin_denomination)
returns void language sql security invoker set search_path = ''
as $$
  insert into public.treasury_history(campaign_id,group_id,character_id,session_id,operation,item,quantity,denomination,author_id,author_name,encounter_id)
  select c,party,target,session,operation,item,quantity,coin,p.id,p.username,
    nullif(current_setting('campaign.encounter_id',true),'')::uuid
  from public.profiles p where p.id = auth.uid();
$$;

create function campaign_private.encounter_step(target uuid, action text, expected integer, loot jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare c uuid := campaign_private.selected_campaign();
declare encounter public.encounters%rowtype;
declare first_id uuid;
declare next_id uuid;
declare current_initiative integer;
declare movement jsonb;
begin
  if auth.uid() is null or not campaign_private.is_campaign_director(c) then raise exception 'Se requiere permiso de director'; end if;
  select * into strict encounter from public.encounters e where (e.campaign_id,e.id) = (c,target) for update;
  if encounter.revision <> expected then raise exception 'El encuentro ha cambiado, recárgalo'; end if;
  select id into first_id from public.encounter_combatants where encounter_id = target order by initiative desc,id limit 1;
  if action = 'start' and encounter.phase = 'prepared' and first_id is not null then
    update public.encounters set phase = 'running', round = 1, turn_id = first_id, revision = revision + 1 where id = target;
  elsif action = 'next' and encounter.phase = 'running' and first_id is not null then
    select initiative into current_initiative from public.encounter_combatants where id = encounter.turn_id;
    select id into next_id from public.encounter_combatants where encounter_id = target
      and (initiative < current_initiative or (initiative = current_initiative and id > encounter.turn_id))
      order by initiative desc,id limit 1;
    update public.encounters set turn_id = coalesce(next_id,first_id),
      round = round + case when next_id is null then 1 else 0 end, revision = revision + 1 where id = target;
  elsif action = 'complete' and encounter.phase = 'running' then
    perform pg_advisory_xact_lock(hashtextextended(c::text,22));
    perform set_config('campaign.encounter_id',target::text,true);
    for movement in select value from jsonb_array_elements(coalesce(loot,'[]')) loop
      if movement->>'operation' is distinct from 'deposit' then raise exception 'El botín tiene que ser un ingreso'; end if;
      perform campaign_private.move_treasure(c,movement,encounter.session_id);
    end loop;
    perform set_config('campaign.encounter_id','',true);
    update public.encounters set phase = 'completed',turn_id = null,revision = revision + 1 where id = target;
  else
    raise exception 'Acción no disponible en el estado actual';
  end if;
end;
$$;
revoke all on function campaign_private.encounter_step(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function campaign_private.encounter_step(uuid,text,integer,jsonb) to authenticated;
create function public.encounter_step(target uuid, action text, expected integer, loot jsonb default '[]')
returns void language sql set search_path = '' as $$ select campaign_private.encounter_step(target,action,expected,loot); $$;
revoke all on function public.encounter_step(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.encounter_step(uuid,text,integer,jsonb) to authenticated;
