create table public.campaign_activity (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns on delete cascade,
  entity_kind text not null check (entity_kind in ('diary_entries','chronicle_quests','chronicle_sessions','organizations','treasury_history')),
  entity_id text not null,
  action text not null check (action in ('insert','update','delete')),
  actor_id uuid references public.profiles on delete set null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index campaign_activity_recent on public.campaign_activity(campaign_id,occurred_at desc);
alter table public.campaign_activity enable row level security;
revoke all on public.campaign_activity from public,anon,authenticated;
grant select on public.campaign_activity to authenticated;
create policy activity_read on public.campaign_activity for select to authenticated
using (campaign_id = (select campaign_private.selected_campaign()) and (
  campaign_private.is_campaign_director(campaign_id)
  or (campaign_private.permitted_in(campaign_id,'tracker',1) and case entity_kind
    when 'diary_entries' then exists(select 1 from public.diary_entries d where d.id::text = entity_id)
    when 'chronicle_quests' then exists(select 1 from public.chronicle_quests q where q.id::text = entity_id)
    when 'chronicle_sessions' then exists(select 1 from public.chronicle_sessions s where s.id::text = entity_id)
    when 'organizations' then exists(select 1 from public.organizations o where o.id::text = entity_id)
    when 'treasury_history' then exists(select 1 from public.treasury_history t where t.id::text = entity_id)
    else false end)
));

create function campaign_private.record_activity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare entry jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  if auth.uid() is null or (tg_op = 'UPDATE' and to_jsonb(old) = entry) then return null; end if;
  -- No user-provided text enters the log. Visibility is resolved against the live source.
  insert into public.campaign_activity(campaign_id,entity_kind,entity_id,action,actor_id)
  values((entry->>'campaign_id')::uuid,tg_table_name,entry->>'id',lower(tg_op),auth.uid());
  return null;
end;
$$;
revoke all on function campaign_private.record_activity() from public,anon,authenticated;
do $$
declare relation text;
begin
  foreach relation in array array['diary_entries','chronicle_quests','chronicle_sessions','organizations','treasury_history']
  loop
    execute format('create trigger activity_record after insert or update or delete on public.%I
      for each row execute function campaign_private.record_activity()', relation);
  end loop;
end $$;
