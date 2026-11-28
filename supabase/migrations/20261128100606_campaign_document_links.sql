create unique index if not exists chronicle_quests_campaign_id_key on public.chronicle_quests(campaign_id,id);

create table public.document_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign(),
  document_id uuid not null,
  npc_id integer,
  organization_id integer,
  creature_id integer,
  place_id integer,
  quest_id uuid,
  check(num_nonnulls(npc_id,organization_id,creature_id,place_id,quest_id)=1),
  unique nulls not distinct(document_id,npc_id,organization_id,creature_id,place_id,quest_id),
  foreign key(campaign_id,document_id) references public.campaign_documents(campaign_id,id) on delete cascade,
  foreign key(campaign_id,npc_id) references public.allies(campaign_id,id) on delete cascade,
  foreign key(campaign_id,organization_id) references public.organizations(campaign_id,id) on delete cascade,
  foreign key(campaign_id,creature_id) references public.creatures(campaign_id,id) on delete cascade,
  foreign key(campaign_id,place_id) references public.points_of_interest(campaign_id,id) on delete cascade,
  foreign key(campaign_id,quest_id) references public.chronicle_quests(campaign_id,id) on delete cascade
);
create index document_links_parent on public.document_links(campaign_id,document_id);
create function campaign_private.document_link_visible(link public.document_links) returns boolean
language sql stable security invoker set search_path=''
as $$
  select case
    when link.npc_id is not null then exists(select 1 from public.allies a where (a.campaign_id,a.id)=(link.campaign_id,link.npc_id))
    when link.organization_id is not null then exists(select 1 from public.organizations o where (o.campaign_id,o.id)=(link.campaign_id,link.organization_id))
    when link.creature_id is not null then exists(select 1 from public.creatures c where (c.campaign_id,c.id)=(link.campaign_id,link.creature_id))
    when link.place_id is not null then exists(select 1 from public.points_of_interest p where (p.campaign_id,p.id)=(link.campaign_id,link.place_id))
    when link.quest_id is not null then exists(select 1 from public.chronicle_quests q where (q.campaign_id,q.id)=(link.campaign_id,link.quest_id))
    else false
  end;
$$;
revoke all on function campaign_private.document_link_visible(public.document_links) from public,anon,authenticated;
grant execute on function campaign_private.document_link_visible(public.document_links) to authenticated;
alter table public.document_links enable row level security;
revoke all on public.document_links from public,anon,authenticated;
grant select,insert(document_id,npc_id,organization_id,creature_id,place_id,quest_id),delete on public.document_links to authenticated;
create policy document_link_read on public.document_links for select to authenticated
using(campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.document_access(campaign_id,document_id,false)
  and campaign_private.document_link_visible(document_links));
create policy document_link_add on public.document_links for insert to authenticated
with check(campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.document_access(campaign_id,document_id,true)
  and campaign_private.document_link_visible(document_links));
create policy document_link_remove on public.document_links for delete to authenticated
using(campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.document_access(campaign_id,document_id,true));
