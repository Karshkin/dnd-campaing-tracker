alter table public.encounter_combatants add column npc_id integer,
  add check(num_nonnulls(npc_id,creature_id,character_id)<=1),
  add foreign key(campaign_id,npc_id) references public.allies(campaign_id,id) on delete set null(npc_id);
grant insert(npc_id) on public.encounter_combatants to authenticated;
