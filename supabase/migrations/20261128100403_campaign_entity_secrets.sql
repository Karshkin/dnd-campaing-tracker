create function campaign_private.visibility_relation(entity_kind text) returns regclass
language sql stable security definer set search_path=''
as $$ select relation from campaign_private.visibility_entities where kind=entity_kind $$;
revoke all on function campaign_private.visibility_relation(text) from public,anon,authenticated;
grant execute on function campaign_private.visibility_relation(text) to authenticated;

create function campaign_private.secret_parent_visible(c uuid, entity_kind text,target text) returns boolean
language plpgsql stable security invoker set search_path=''
as $$
declare relation regclass := campaign_private.visibility_relation(entity_kind);
declare visible boolean;
begin
  if auth.uid() is null or c is distinct from campaign_private.selected_campaign() or relation is null then return false; end if;
  execute format('select exists(select 1 from %s where campaign_id=$1 and id::text=$2)',relation) into visible using c,target;
  return visible;
exception when insufficient_privilege then
  return false;
end;
$$;
revoke all on function campaign_private.secret_parent_visible(uuid,text,text) from public,anon,authenticated;
grant execute on function campaign_private.secret_parent_visible(uuid,text,text) to authenticated;

create table public.entity_secrets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  kind text not null references campaign_private.visibility_entities(kind),
  entity_id text not null check(length(entity_id) between 1 and 36),
  label text not null check(length(btrim(label)) between 1 and 120),
  content text not null check(length(btrim(content)) between 1 and 20000),
  audience text not null default 'director' check(audience in ('director','campaign','characters')),
  recipients integer[] not null default '{}',
  check((audience='characters' and cardinality(recipients) between 1 and 100)
     or (audience<>'characters' and cardinality(recipients)=0))
);
create index entity_secrets_parent on public.entity_secrets(campaign_id,kind,entity_id);
alter table public.entity_secrets enable row level security;
revoke all on public.entity_secrets from public,anon,authenticated;
grant select,delete,insert(kind,entity_id,label,content,audience,recipients),
  update(label,content,audience,recipients) on public.entity_secrets to authenticated;
create policy entity_secrets_read on public.entity_secrets for select to authenticated
using(campaign_id=(select campaign_private.selected_campaign())
  and campaign_private.secret_parent_visible(campaign_id,kind,entity_id) and (
    campaign_private.is_campaign_director(campaign_id) or audience='campaign'
    or (audience='characters' and exists(select 1 from public.characters c
      where c.campaign_id=entity_secrets.campaign_id and c.id=any(entity_secrets.recipients) and c.user_id=(select auth.uid())))
  ));
create policy entity_secret_director on public.entity_secrets for all to authenticated
using(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id))
with check(campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id)
  and campaign_private.secret_parent_visible(campaign_id,kind,entity_id)
  and cardinality(recipients)=(select count(*) from public.characters c
    where c.campaign_id=entity_secrets.campaign_id and c.id=any(entity_secrets.recipients)));
