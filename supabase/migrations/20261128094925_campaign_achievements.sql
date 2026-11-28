create table public.campaign_achievements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  character_id integer,
  group_id integer,
  session_id uuid,
  kind text not null check (kind in ('achievement','title','recognition')),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 10000),
  reward text not null default '' check (length(reward) <= 2000),
  icon text not null default 'award' check (icon in ('award','crown','medal','shield','star','trophy')),
  earned_on date not null default current_date,
  visibility text not null default 'recipient' check (visibility in ('recipient','campaign','director')),
  check (num_nonnulls(character_id,group_id) = 1),
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id) on delete cascade,
  foreign key (campaign_id,group_id) references public.inventory_groups(campaign_id,id) on delete cascade,
  foreign key (campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete set null(session_id)
);
create index achievements_for_character on public.campaign_achievements(campaign_id,character_id,earned_on desc);
create index achievements_for_group on public.campaign_achievements(campaign_id,group_id,earned_on desc);
create index achievements_for_session on public.campaign_achievements(campaign_id,session_id) where session_id is not null;

create function campaign_private.can_view_achievement(c uuid, target_character integer, target_group integer, visibility text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    campaign_private.is_campaign_director(c) or (
      campaign_private.permitted_in(c,case when target_character is null then 'tracker' else 'characters' end,1)
      and (visibility = 'campaign' or (visibility = 'recipient' and (
        exists(select 1 from public.characters ch
               where (ch.campaign_id,ch.id,ch.user_id) = (c,target_character,(select auth.uid())))
        or exists(select 1 from public.inventory_group_members m
                  where (m.campaign_id,m.group_id,m.user_id) = (c,target_group,(select auth.uid())))
      )))
    )
  );
$$;
revoke all on function campaign_private.can_view_achievement(uuid,integer,integer,text) from public,anon,authenticated;
grant execute on function campaign_private.can_view_achievement(uuid,integer,integer,text) to authenticated;

alter table public.campaign_achievements enable row level security;
revoke all on public.campaign_achievements from public,anon,authenticated;
grant select,delete,
  insert(character_id,group_id,session_id,kind,name,description,reward,icon,earned_on,visibility),
  update(session_id,kind,name,description,reward,icon,earned_on,visibility)
on public.campaign_achievements to authenticated;
create policy achievement_read on public.campaign_achievements for select to authenticated
using (campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.can_view_achievement(campaign_id,character_id,group_id,visibility));
create policy achievement_director on public.campaign_achievements for all to authenticated
using (campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id))
with check (campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id));
