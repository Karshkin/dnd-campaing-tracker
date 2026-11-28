create table public.harptos_clock (
  campaign_id uuid primary key references public.campaigns on delete cascade,
  world_day integer not null check (world_day between 0 and 36599999)
);

create table public.harptos_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  notes text not null default '',
  kind text not null default 'event' check (kind in ('event','travel')),
  world_day integer not null check (world_day between 0 and 36599999),
  duration integer not null default 0 check (duration between 0 and 36500),
  private boolean not null default false,
  session_id uuid,
  foreign key(campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete set null(session_id)
);
create index harptos_events_timeline on public.harptos_events(campaign_id,world_day,id);
alter table public.harptos_clock enable row level security;
alter table public.harptos_events enable row level security;
revoke all on public.harptos_clock,public.harptos_events from public,anon,authenticated;
grant select on public.harptos_clock,public.harptos_events to authenticated;
grant insert(title,notes,kind,world_day,duration,private,session_id),
  update(title,notes,kind,world_day,duration,private,session_id),delete on public.harptos_events to authenticated;
create policy calendar_clock_read on public.harptos_clock for select to authenticated
using (campaign_id = (select campaign_private.selected_campaign()) and campaign_private.permitted_in(campaign_id,'tracker',1));
create policy calendar_event_read on public.harptos_events for select to authenticated
using (campaign_id = (select campaign_private.selected_campaign()) and (
  campaign_private.is_campaign_director(campaign_id) or (
    not private and campaign_private.permitted_in(campaign_id,'tracker',1)
    and campaign_private.can_discover(campaign_id,'harptos_events',id::text)
    and (session_id is null or exists(select 1 from public.chronicle_sessions where id = session_id))
  )
));
create policy calendar_event_insert on public.harptos_events for insert to authenticated
with check (campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id));
create policy calendar_event_update on public.harptos_events for update to authenticated
using (campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id))
with check (campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id));
create policy calendar_event_delete on public.harptos_events for delete to authenticated
using (campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id));
insert into campaign_private.visibility_entities values ('harptos_events','public.harptos_events');

create function campaign_private.set_harptos_date(day_number integer, advance integer) returns integer
language plpgsql security definer set search_path = ''
as $$
declare c uuid := campaign_private.selected_campaign();
declare result integer;
begin
  if auth.uid() is null or not campaign_private.is_campaign_director(c) then raise exception 'Se requiere permiso de director'; end if;
  if num_nonnulls(day_number,advance) <> 1 or advance not between 1 and 36500 then raise exception 'Fecha o avance inválidos'; end if;
  if day_number is not null then
    insert into public.harptos_clock(campaign_id,world_day) values(c,day_number)
    on conflict(campaign_id) do update set world_day = excluded.world_day
    returning world_day into result;
  else
    update public.harptos_clock set world_day = world_day + advance where campaign_id = c returning world_day into result;
    if not found then raise exception 'Fija la fecha de campaña antes de avanzar'; end if;
  end if;
  return result;
end;
$$;
revoke all on function campaign_private.set_harptos_date(integer,integer) from public,anon,authenticated;
grant execute on function campaign_private.set_harptos_date(integer,integer) to authenticated;
create function public.set_harptos_date(day_number integer default null, advance integer default null) returns integer
language sql set search_path = '' as $$ select campaign_private.set_harptos_date(day_number,advance); $$;
revoke all on function public.set_harptos_date(integer,integer) from public,anon,authenticated;
grant execute on function public.set_harptos_date(integer,integer) to authenticated;
