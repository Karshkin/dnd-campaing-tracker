create table public.campaign_rumors (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  title text not null check(length(btrim(title)) between 1 and 120),
  body text not null check(length(btrim(body)) between 1 and 10000),
  origin text not null default '' check(length(origin) <= 120),
  heard_on date not null default current_date,
  status text not null default 'unverified' check(status in ('unverified','confirmed','refuted')),
  shared boolean not null default true,
  author_character_id integer,
  author_user_id uuid references public.profiles on delete set null,
  author_character_name text,
  author_account_name text,
  place_id integer,
  unique(campaign_id,id),
  foreign key(campaign_id,author_character_id) references public.characters(campaign_id,id) on delete set null(author_character_id),
  foreign key(campaign_id,place_id) references public.points_of_interest(campaign_id,id) on delete set null(place_id)
);
create index campaign_rumors_by_campaign on public.campaign_rumors(campaign_id,heard_on desc);
create trigger stamp_rumor before insert on public.campaign_rumors for each row
execute function campaign_private.sign_chronicle_record();
insert into campaign_private.visibility_entities values('campaign_rumors','public.campaign_rumors');
alter table public.campaign_rumors enable row level security;
revoke all on public.campaign_rumors from public,anon,authenticated;
grant select,delete,insert(title,body,origin,heard_on,shared,author_character_id,place_id),
  update(title,body,origin,heard_on,shared,place_id,status) on public.campaign_rumors to authenticated;
create policy rumor_read on public.campaign_rumors for select to authenticated
using (campaign_id=(select campaign_private.selected_campaign()) and
  campaign_private.can_read_chronicle_record(campaign_id,case when shared then 'shared' else 'private' end,author_user_id)
  and campaign_private.can_discover(campaign_id,'campaign_rumors',id::text)
  and (place_id is null or exists (select 1 from public.points_of_interest p
    where (p.campaign_id,p.id)=(campaign_rumors.campaign_id,campaign_rumors.place_id))));
create policy rumor_insert on public.campaign_rumors for insert to authenticated
with check (campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.can_edit_chronicle_record(campaign_id,author_user_id));
create policy rumor_update on public.campaign_rumors for update to authenticated
using (campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.can_edit_chronicle_record(campaign_id,author_user_id))
with check (campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.can_edit_chronicle_record(campaign_id,author_user_id));
create policy rumor_delete on public.campaign_rumors for delete to authenticated
using (campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.can_edit_chronicle_record(campaign_id,author_user_id));

create function campaign_private.validate_rumor() returns trigger
language plpgsql security invoker set search_path=''
as $$
begin
  if new.place_id is not null and not exists (select 1 from public.points_of_interest p
    where (p.campaign_id,p.id)=(new.campaign_id,new.place_id)) then raise exception 'Localización no disponible'; end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and
    not campaign_private.is_campaign_director(new.campaign_id) then raise exception 'Solo la dirección valida rumores'; end if;
  return new;
end;
$$;
revoke all on function campaign_private.validate_rumor() from public,anon,authenticated;
create trigger verify_rumor before insert or update on public.campaign_rumors for each row
execute function campaign_private.validate_rumor();

create function campaign_private.investigation_entity_visible(c uuid,kind text,target text)
returns boolean language sql stable security invoker set search_path=''
as $$
  select case kind
    when 'clue' then target is null
    when 'npc' then exists(select 1 from public.allies a where a.campaign_id=c and a.id::text=target)
    when 'organization' then exists(select 1 from public.organizations o where o.campaign_id=c and o.id::text=target)
    when 'place' then exists(select 1 from public.points_of_interest p where p.campaign_id=c and p.id::text=target)
    when 'document' then exists(select 1 from public.campaign_documents d where d.campaign_id=c and d.id::text=target)
    when 'rumor' then exists(select 1 from public.campaign_rumors r where r.campaign_id=c and r.id::text=target)
    when 'quest' then exists(select 1 from public.chronicle_quests q where q.campaign_id=c and q.id::text=target)
    when 'event' then exists(select 1 from public.map_events e where e.campaign_id=c and e.id::text=target)
    else false
  end;
$$;
revoke all on function campaign_private.investigation_entity_visible(uuid,text,text) from public,anon,authenticated;
grant execute on function campaign_private.investigation_entity_visible(uuid,text,text) to authenticated;

create table public.investigation_nodes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  owner uuid default auth.uid() references public.profiles on delete set null,
  kind text not null check(kind in ('clue','npc','organization','place','document','rumor','quest','event')),
  entity_id text check(length(entity_id) <= 36),
  title text not null default '' check(length(title) <= 120),
  notes text not null default '' check(length(notes) <= 10000),
  shared boolean not null default true,
  x integer not null default 50 check(x between 8 and 92),
  y integer not null default 50 check(y between 8 and 92),
  unique(campaign_id,id),
  check((kind='clue' and entity_id is null and length(btrim(title))>0) or (kind<>'clue' and entity_id is not null))
);
create index investigation_nodes_by_campaign on public.investigation_nodes(campaign_id);
alter table public.investigation_nodes enable row level security;
revoke all on public.investigation_nodes from public,anon,authenticated;
grant select,delete,insert(kind,entity_id,title,notes,shared,x,y),
  update(title,notes,shared,x,y) on public.investigation_nodes to authenticated;
create policy investigation_node_read on public.investigation_nodes for select to authenticated
using(campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.can_read_chronicle_record(campaign_id,case when shared then 'shared' else 'private' end,owner)
  and campaign_private.investigation_entity_visible(campaign_id,kind,entity_id));
create policy investigation_node_insert on public.investigation_nodes for insert to authenticated
with check(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.can_edit_chronicle_record(campaign_id,owner)
  and campaign_private.investigation_entity_visible(campaign_id,kind,entity_id));
create policy investigation_node_update on public.investigation_nodes for update to authenticated
using(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.can_edit_chronicle_record(campaign_id,owner))
with check(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.can_edit_chronicle_record(campaign_id,owner)
  and campaign_private.investigation_entity_visible(campaign_id,kind,entity_id));
create policy investigation_node_delete on public.investigation_nodes for delete to authenticated
using(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.can_edit_chronicle_record(campaign_id,owner));

create table public.investigation_edges (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign(),
  owner uuid default auth.uid() references public.profiles on delete set null,
  source uuid not null,
  target uuid not null,
  label text not null default '' check(length(label) <= 140),
  shared boolean not null default true,
  check(source<>target),
  unique(campaign_id,source,target,owner),
  foreign key(campaign_id,source) references public.investigation_nodes(campaign_id,id) on delete cascade,
  foreign key(campaign_id,target) references public.investigation_nodes(campaign_id,id) on delete cascade
);
create index investigation_edges_target on public.investigation_edges(campaign_id,target);
alter table public.investigation_edges enable row level security;
revoke all on public.investigation_edges from public,anon,authenticated;
grant select,delete,insert(source,target,label,shared) on public.investigation_edges to authenticated;
create policy investigation_edge_read on public.investigation_edges for select to authenticated
using(campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.can_read_chronicle_record(campaign_id,case when shared then 'shared' else 'private' end,owner)
  and exists(select 1 from public.investigation_nodes n where n.id=source)
  and exists(select 1 from public.investigation_nodes n where n.id=target));
create policy investigation_edge_insert on public.investigation_edges for insert to authenticated
with check(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.can_edit_chronicle_record(campaign_id,owner)
  and exists(select 1 from public.investigation_nodes n where n.id=source)
  and exists(select 1 from public.investigation_nodes n where n.id=target));
create policy investigation_edge_delete on public.investigation_edges for delete to authenticated
using(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.can_edit_chronicle_record(campaign_id,owner));
