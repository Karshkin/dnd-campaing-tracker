create unique index if not exists chronicle_quests_campaign_id_key on public.chronicle_quests(campaign_id,id);
alter table public.campaign_achievements
  add column quest_id uuid,
  add column encounter_id uuid,
  add foreign key(campaign_id,quest_id) references public.chronicle_quests(campaign_id,id) on delete set null(quest_id),
  add foreign key(campaign_id,encounter_id) references public.encounters(campaign_id,id) on delete set null(encounter_id);
create index achievements_for_quest on public.campaign_achievements(campaign_id,quest_id) where quest_id is not null;
create index achievements_for_encounter on public.campaign_achievements(campaign_id,encounter_id) where encounter_id is not null;
grant insert(quest_id,encounter_id),update(quest_id,encounter_id) on public.campaign_achievements to authenticated;
create policy achievement_context on public.campaign_achievements as restrictive for select to authenticated
using(campaign_private.is_campaign_director(campaign_id) or (
  (session_id is null or exists(select 1 from public.chronicle_sessions s
    where (s.campaign_id,s.id)=(campaign_achievements.campaign_id,campaign_achievements.session_id)))
  and (quest_id is null or exists(select 1 from public.chronicle_quests q
    where (q.campaign_id,q.id)=(campaign_achievements.campaign_id,campaign_achievements.quest_id)))
  and (encounter_id is null or campaign_private.encounter_visible(campaign_id,encounter_id))
));
