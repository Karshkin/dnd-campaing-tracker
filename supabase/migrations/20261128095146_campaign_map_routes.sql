create table public.campaign_map_routes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  map_id integer not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 5000),
  waypoints integer[] not null check (cardinality(waypoints) between 2 and 30),
  foreign key (campaign_id,map_id) references public.maps(campaign_id,id) on delete cascade
);
create index map_routes_by_map on public.campaign_map_routes(campaign_id,map_id);
insert into campaign_private.visibility_entities values('campaign_map_routes','public.campaign_map_routes');

create function campaign_private.map_route_points(c uuid, parent integer, route_points integer[], visible_only boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and campaign_private.is_campaign_member(c) and not exists (
    select 1 from unnest(route_points) as point(id)
    where not exists (
      select 1 from public.points_of_interest p
      where (p.campaign_id,p.map_id,p.id) = (c,parent,point.id)
        and (not visible_only or campaign_private.can_discover(c,'points_of_interest',p.id::text))
    )
  );
$$;
revoke all on function campaign_private.map_route_points(uuid,integer,integer[],boolean) from public,anon,authenticated;
grant execute on function campaign_private.map_route_points(uuid,integer,integer[],boolean) to authenticated;

alter table public.campaign_map_routes enable row level security;
revoke all on public.campaign_map_routes from public,anon,authenticated;
grant select,delete,insert(map_id,name,description,waypoints),update(name,description,waypoints)
on public.campaign_map_routes to authenticated;
create policy map_routes_read on public.campaign_map_routes for select to authenticated
using (campaign_id=(select campaign_private.selected_campaign()) and (
  campaign_private.is_campaign_director(campaign_id) or (
    campaign_private.permitted_in(campaign_id,'tracker',1)
    and campaign_private.can_discover(campaign_id,'maps',map_id::text)
    and campaign_private.can_discover(campaign_id,'campaign_map_routes',id::text)
    and campaign_private.map_route_points(campaign_id,map_id,waypoints,true)
  )
));
create policy map_routes_director on public.campaign_map_routes for all to authenticated
using (campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id))
with check (campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id)
  and campaign_private.map_route_points(campaign_id,map_id,waypoints,false));
