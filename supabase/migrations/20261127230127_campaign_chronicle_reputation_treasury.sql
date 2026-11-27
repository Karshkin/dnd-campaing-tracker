-- Campaign chronicle, with private director notes kept outside the published row.
create table public.chronicle_chapters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  position integer not null default 0,
  unique (campaign_id,id)
);

create table public.chronicle_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  chapter_id uuid,
  title text not null check (length(btrim(title)) between 1 and 120),
  played_on date not null,
  status text not null default 'draft' check (status in ('draft','published','closed')),
  summary text not null default '' check (length(summary) <= 100000),
  rewards text not null default '',
  decisions text not null default '',
  consequences text not null default '',
  unique (campaign_id,id),
  foreign key (campaign_id,chapter_id) references public.chronicle_chapters(campaign_id,id) on delete set null (chapter_id)
);

create table public.chronicle_notes (
  campaign_id uuid not null default campaign_private.selected_campaign(),
  session_id uuid primary key,
  notes text not null default '',
  foreign key (campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete cascade
);

create table public.chronicle_attendance (
  campaign_id uuid not null default campaign_private.selected_campaign(),
  session_id uuid not null,
  character_id integer not null,
  primary key (session_id,character_id),
  foreign key (campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete cascade,
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id) on delete cascade
);

create table public.chronicle_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign(),
  session_id uuid not null,
  npc_id integer,
  organization_id integer,
  creature_id integer,
  place_id integer,
  check (num_nonnulls(npc_id, organization_id, creature_id, place_id) = 1),
  unique nulls not distinct (session_id,npc_id,organization_id,creature_id,place_id),
  foreign key (campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete cascade,
  foreign key (campaign_id,npc_id) references public.allies(campaign_id,id) on delete cascade,
  foreign key (campaign_id,organization_id) references public.organizations(campaign_id,id) on delete cascade,
  foreign key (campaign_id,creature_id) references public.creatures(campaign_id,id) on delete cascade,
  foreign key (campaign_id,place_id) references public.points_of_interest(campaign_id,id) on delete cascade
);

create table public.chronicle_quests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  session_id uuid,
  title text not null check (length(btrim(title)) between 1 and 120),
  status text not null default 'active' check (status in ('active','completed','failed')),
  description text not null default '',
  foreign key (campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete set null (session_id)
);

create table public.chronicle_images (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  object_path text not null unique,
  caption text not null default '',
  cover boolean not null default false,
  check (object_path ~ ('^' || campaign_id::text || '/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$'))
);
create unique index chronicle_cover_idx on public.chronicle_images(campaign_id) where cover;

do $$
declare relation text;
begin
  foreach relation in array array['chronicle_chapters','chronicle_sessions','chronicle_notes',
    'chronicle_attendance','chronicle_links','chronicle_quests','chronicle_images']
  loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated', relation);
    execute format('grant select, insert, update, delete on public.%I to authenticated', relation);
    execute format('create policy director on public.%I for all to authenticated
      using (campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id))
      with check (campaign_id = (select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id))', relation);
    execute format('create index on public.%I(campaign_id)', relation);
  end loop;
end $$;

-- Closure is irreversible through the API and can only be performed by its RPC.
revoke insert, update, delete on public.chronicle_sessions from authenticated;
grant insert (chapter_id,title,played_on,summary,rewards,decisions,consequences),
      update (chapter_id,title,played_on,summary,rewards,decisions,consequences)
on public.chronicle_sessions to authenticated;

create policy players_read on public.chronicle_sessions for select to authenticated
using (campaign_id = (select campaign_private.selected_campaign())
  and campaign_private.permitted_in(campaign_id,'tracker',1) and status in ('published','closed'));

do $$
declare relation text;
begin
  foreach relation in array array['chronicle_chapters','chronicle_attendance','chronicle_links','chronicle_quests','chronicle_images']
  loop
    execute format('create policy players_read on public.%I for select to authenticated
      using (campaign_id = (select campaign_private.selected_campaign())
      and campaign_private.permitted_in(campaign_id,''tracker'',1) %s)', relation,
      case when relation = 'chronicle_links' then
        'and exists (select 1 from public.chronicle_sessions s where s.id = session_id)
         and (npc_id is null or exists (select 1 from public.allies a where a.id = npc_id))
         and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id))
         and (creature_id is null or exists (select 1 from public.creatures c where c.id = creature_id))
         and (place_id is null or exists (select 1 from public.points_of_interest p where p.id = place_id))'
      when relation = 'chronicle_attendance' then
        'and exists (select 1 from public.chronicle_sessions s where s.id = session_id)
         and exists (select 1 from public.characters c where c.id = character_id)'
      when relation = 'chronicle_quests' then
        'and (session_id is null or exists (select 1 from public.chronicle_sessions s where s.id = session_id))'
      else '' end);
  end loop;
end $$;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('chronicle-images','chronicle-images',false,10485760,
  array['image/png','image/jpeg','image/webp','image/gif','image/avif']);

create function campaign_private.chronicle_asset_access(object_name text, edit boolean) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select case when object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$'
  then case when edit then campaign_private.is_campaign_director(split_part(object_name,'/',1)::uuid)
    else campaign_private.permitted_in(split_part(object_name,'/',1)::uuid,'tracker',1) end
  else false end;
$$;
revoke all on function campaign_private.chronicle_asset_access(text,boolean) from public, anon, authenticated;
grant execute on function campaign_private.chronicle_asset_access(text,boolean) to authenticated;
create policy chronicle_assets_read on storage.objects for select to authenticated
using (bucket_id = 'chronicle-images' and campaign_private.chronicle_asset_access(name,false));
create policy chronicle_assets_upload on storage.objects for insert to authenticated
with check (bucket_id = 'chronicle-images' and campaign_private.chronicle_asset_access(name,true));
create policy chronicle_assets_delete on storage.objects for delete to authenticated
using (bucket_id = 'chronicle-images' and campaign_private.chronicle_asset_access(name,true));
create policy guard_chronicle_assets_read on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'chronicle-images' or campaign_private.chronicle_asset_access(name,false));
create policy guard_chronicle_assets_upload on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'chronicle-images' or campaign_private.chronicle_asset_access(name,true));
create policy guard_chronicle_assets_delete on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'chronicle-images' or campaign_private.chronicle_asset_access(name,true));
create policy guard_chronicle_assets_update on storage.objects as restrictive for update to authenticated
using (bucket_id <> 'chronicle-images') with check (bucket_id <> 'chronicle-images');

create table public.faction_reputation (
  campaign_id uuid not null references public.campaigns on delete cascade,
  organization_id integer not null,
  group_id integer not null,
  score integer not null default 0 check (score between -100 and 100),
  visible boolean not null default true,
  primary key (campaign_id,organization_id,group_id),
  foreign key (campaign_id,organization_id) references public.organizations(campaign_id,id) on delete cascade,
  foreign key (campaign_id,group_id) references public.inventory_groups(campaign_id,id) on delete cascade
);

create table public.faction_reputation_history (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  organization_id integer not null,
  group_id integer not null,
  requested integer not null,
  previous_score integer not null,
  score integer not null,
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  session_id uuid,
  author_id uuid references public.profiles on delete set null,
  author_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (campaign_id,organization_id,group_id)
    references public.faction_reputation on delete cascade,
  foreign key (campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete set null (session_id)
);
create index faction_reputation_history_target_idx on public.faction_reputation_history(campaign_id,organization_id,group_id,created_at desc);

alter table public.faction_reputation enable row level security;
alter table public.faction_reputation_history enable row level security;
revoke all on public.faction_reputation, public.faction_reputation_history from public, anon, authenticated;
grant select on public.faction_reputation, public.faction_reputation_history to authenticated;

create policy reputation_read on public.faction_reputation for select to authenticated
using (campaign_id = (select campaign_private.selected_campaign()) and (
  campaign_private.is_campaign_director(campaign_id) or (
    visible and campaign_private.permitted_in(campaign_id,'organizations',1)
    and exists (select 1 from public.inventory_group_members m where m.group_id = faction_reputation.group_id)
  )
));
create policy reputation_history_read on public.faction_reputation_history for select to authenticated
using (exists (select 1 from public.faction_reputation r where
  (r.campaign_id,r.organization_id,r.group_id) =
  (faction_reputation_history.campaign_id,faction_reputation_history.organization_id,faction_reputation_history.group_id))
  and (session_id is null or exists (select 1 from public.chronicle_sessions s where s.id = session_id)));

create function campaign_private.change_reputation(c uuid, organization integer, party integer,
  delta integer, reason text, session_id uuid, visibility boolean) returns void
language plpgsql security invoker set search_path = ''
as $$
declare previous integer;
declare next_score integer;
begin
  insert into public.faction_reputation(campaign_id,organization_id,group_id)
  values(c,organization,party) on conflict do nothing;
  select r.score into strict previous from public.faction_reputation r
  where (r.campaign_id,r.organization_id,r.group_id) = (c,organization,party) for update;
  if delta is not null then
    if delta = 0 then raise exception 'Reputation adjustment must be nonzero'; end if;
    next_score := greatest(-100,least(100,previous::bigint + delta));
    insert into public.faction_reputation_history(campaign_id,organization_id,group_id,requested,
      previous_score,score,reason,session_id,author_id,author_name)
    select c,organization,party,delta,previous,next_score,btrim(reason),session_id,p.id,p.username
    from public.profiles p where p.id = auth.uid();
  end if;
  update public.faction_reputation r set score = coalesce(next_score,previous), visible = coalesce(visibility,r.visible)
  where (r.campaign_id,r.organization_id,r.group_id) = (c,organization,party);
end;
$$;
revoke all on function campaign_private.change_reputation(uuid,integer,integer,integer,text,uuid,boolean) from public,anon,authenticated;

-- Seed existing pairs and create missing pairs when either entity is added.
insert into public.faction_reputation(campaign_id,organization_id,group_id)
select o.campaign_id,o.id,g.id from public.organizations o join public.inventory_groups g using (campaign_id);
create function campaign_private.seed_reputation() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Concurrent creation of a group and an organization must also create their pair.
  perform pg_advisory_xact_lock(hashtextextended(new.campaign_id::text,21));
  if tg_table_name = 'organizations' then
    insert into public.faction_reputation(campaign_id,organization_id,group_id)
    select new.campaign_id,new.id,g.id from public.inventory_groups g where g.campaign_id = new.campaign_id
    on conflict do nothing;
  else
    insert into public.faction_reputation(campaign_id,organization_id,group_id)
    select new.campaign_id,o.id,new.id from public.organizations o where o.campaign_id = new.campaign_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function campaign_private.seed_reputation() from public,anon,authenticated;
create trigger seed_group_reputation after insert on public.inventory_groups
for each row execute function campaign_private.seed_reputation();
create trigger seed_organization_reputation after insert on public.organizations
for each row execute function campaign_private.seed_reputation();

-- Existing item rows remain canonical, preserving their IDs and owners.
create type public.treasure_details as (
  category text, rarity text, weight numeric, value_gp numeric,
  description text, quest_item boolean, unidentified boolean
);
alter table public.inventory_group_contributions
  add column details public.treasure_details,
  add constraint contribution_details_valid check (details is null or
    ((details).category = category and (details).rarity in ('common','uncommon','rare','very_rare','legendary','artifact')
     and (details).weight between 0 and 1000000000 and (details).value_gp between 0 and 1000000000));
alter table public.character_inventory add column details public.treasure_details;

create type public.coin_denomination as enum ('cp','sp','ep','gp','pp');

create table public.treasury_wallet (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns on delete cascade,
  group_id integer,
  character_id integer,
  denomination public.coin_denomination not null,
  balance bigint not null check (balance between 0 and 9007199254740991),
  check (num_nonnulls(group_id,character_id) = 1),
  unique nulls not distinct (campaign_id,group_id,character_id,denomination),
  foreign key (campaign_id,group_id) references public.inventory_groups(campaign_id,id) on delete cascade,
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id) on delete cascade
);

create table public.treasury_history (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns on delete cascade,
  group_id integer not null,
  character_id integer,
  session_id uuid,
  author_id uuid references public.profiles on delete set null,
  author_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  operation text not null check (operation in ('deposit','withdraw','consume','to_group','to_character','distribution','correction')),
  item text not null,
  quantity bigint not null check (quantity > 0 or (operation = 'correction' and quantity < 0)),
  denomination public.coin_denomination,
  foreign key (campaign_id,group_id) references public.inventory_groups(campaign_id,id) on delete cascade,
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id) on delete set null (character_id),
  foreign key (campaign_id,session_id) references public.chronicle_sessions(campaign_id,id) on delete set null (session_id)
);
create index treasury_history_group_idx on public.treasury_history(campaign_id,group_id,created_at desc);

create function campaign_private.treasury_group_access(c uuid, party integer) returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and c = campaign_private.selected_campaign()
  and exists (select 1 from public.inventory_groups g where (g.campaign_id,g.id) = (c,party))
  and (campaign_private.is_campaign_director(c) or (
    campaign_private.permitted_in(c,'tracker',1) and exists (
      select 1 from public.inventory_group_members m where
      (m.campaign_id,m.group_id,m.user_id) = (c,party,auth.uid())
    )
  ));
$$;
revoke all on function campaign_private.treasury_group_access(uuid,integer) from public,anon,authenticated;
grant execute on function campaign_private.treasury_group_access(uuid,integer) to authenticated;

alter table public.treasury_wallet enable row level security;
alter table public.treasury_history enable row level security;
revoke all on public.treasury_wallet, public.treasury_history from public,anon,authenticated;
grant select on public.treasury_wallet, public.treasury_history to authenticated;
create policy wallet_read on public.treasury_wallet for select to authenticated
using (campaign_id = (select campaign_private.selected_campaign()) and (
  campaign_private.treasury_group_access(campaign_id,group_id) or
  (campaign_private.permitted_in(campaign_id,'characters',1)
    and exists(select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid())))
));
create policy treasury_history_read on public.treasury_history for select to authenticated
using (campaign_private.treasury_group_access(campaign_id,group_id)
  and (session_id is null or exists (select 1 from public.chronicle_sessions s where s.id = session_id)));
create policy contributions_director_read on public.inventory_group_contributions for select to authenticated
using (campaign_private.is_campaign_director(campaign_id));

create table campaign_private.treasury_requests (
  campaign_id uuid not null references public.campaigns on delete cascade,
  author_id uuid not null references public.profiles on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  primary key(campaign_id,author_id,request_id)
);
alter table campaign_private.treasury_requests enable row level security;
revoke all on campaign_private.treasury_requests from public,anon,authenticated;

create function campaign_private.record_treasury(c uuid, party integer, target integer,
  session uuid, operation text, item text, quantity bigint, coin public.coin_denomination)
returns void language sql security invoker set search_path = ''
as $$
  insert into public.treasury_history(campaign_id,group_id,character_id,session_id,operation,item,quantity,denomination,author_id,author_name)
  select c,party,target,session,operation,item,quantity,coin,p.id,p.username
  from public.profiles p where p.id = auth.uid();
$$;
revoke all on function campaign_private.record_treasury(uuid,integer,integer,uuid,text,text,bigint,public.coin_denomination) from public,anon,authenticated;

-- Preserve the existing contribution API and audit those writes too.
create function campaign_private.audit_contribution() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform campaign_private.record_treasury(new.campaign_id,new.group_id,null,null,'deposit',new.name,new.quantity,null);
  elsif tg_op = 'DELETE' then
    if exists(select 1 from public.inventory_groups where id = old.group_id) then
      perform campaign_private.record_treasury(old.campaign_id,old.group_id,null,null,'withdraw',old.name,old.quantity,null);
    end if;
  elsif new.quantity <> old.quantity then
    perform campaign_private.record_treasury(new.campaign_id,new.group_id,null,null,'correction',new.name,
      new.quantity::bigint - old.quantity,null);
  end if;
  return null;
end;
$$;
revoke all on function campaign_private.audit_contribution() from public,anon,authenticated;
create trigger audit_contribution after insert or update or delete on public.inventory_group_contributions
for each row when (current_user = 'authenticated') execute function campaign_private.audit_contribution();

create function campaign_private.change_wallet(c uuid, party integer, target integer,
  coin public.coin_denomination, delta bigint) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  insert into public.treasury_wallet(campaign_id,group_id,character_id,denomination,balance)
  values(c,party,target,coin,0) on conflict do nothing;
  update public.treasury_wallet w set balance = w.balance + delta
  where w.campaign_id = c and w.group_id is not distinct from party and w.character_id is not distinct from target
    and w.denomination = coin and w.balance + delta >= 0;
  if not found then raise exception 'Insufficient coin balance'; end if;
end;
$$;
revoke all on function campaign_private.change_wallet(uuid,integer,integer,public.coin_denomination,bigint) from public,anon,authenticated;

create function campaign_private.move_treasure(c uuid, payload jsonb, session uuid) returns void
language plpgsql security invoker set search_path = ''
as $$
declare party integer := (payload->>'group_id')::integer;
declare target integer := (payload->>'character_id')::integer;
declare source_id integer := (payload->>'item_id')::integer;
declare amount integer := (payload->>'quantity')::integer;
declare action text := payload->>'operation';
declare coin public.coin_denomination := (payload->>'denomination')::public.coin_denomination;
declare details public.treasure_details;
declare stock integer;
declare legacy_description text;
declare label text;
declare owner_id uuid;
declare director boolean := campaign_private.is_campaign_director(c);
begin
  if not coalesce(campaign_private.treasury_group_access(c,party),false) then raise exception 'Group access required'; end if;
  if amount is null or amount not between 1 and 1000000000 then raise exception 'Invalid quantity'; end if;
  if action is null or action not in ('deposit','withdraw','consume','to_group','to_character','distribution') then
    raise exception 'Invalid treasury operation';
  end if;
  if session is not null and not exists(select 1 from public.chronicle_sessions s
    where (s.campaign_id,s.id) = (c,session) and (director or s.status in ('published','closed'))) then
    raise exception 'Session unavailable';
  end if;

  if action in ('to_group','to_character','distribution') then
    select ch.user_id into owner_id from public.characters ch where (ch.campaign_id,ch.id) = (c,target) for key share;
    if owner_id is null or (owner_id <> auth.uid() and not (director and action in ('distribution','to_character')
       and exists(select 1 from public.inventory_group_members m
         where (m.campaign_id,m.group_id,m.user_id) = (c,party,owner_id))))
       or (owner_id = auth.uid() and not campaign_private.permitted_in(c,'characters',2)) then
      raise exception 'Character access required';
    end if;
  else
    target := null;
  end if;

  if coin is not null then
    if action = 'to_group' then
      perform campaign_private.change_wallet(c,null,target,coin,-amount);
    end if;
    perform campaign_private.change_wallet(c,party,null,coin,case when action in ('deposit','to_group') then amount else -amount end);
    if action in ('distribution','to_character') then
      perform campaign_private.change_wallet(c,null,target,coin,amount);
    end if;
    label := coin::text;
  elsif action = 'distribution' then
    raise exception 'Choose a coin denomination';
  else
    if action = 'deposit' then
      label := btrim(payload->>'name');
      select * into details from jsonb_populate_record(null::public.treasure_details, payload->'details');
      if details.category is null or details.rarity is null or details.weight is null
         or details.value_gp is null or details.description is null or details.quest_item is null
         or details.unidentified is null then raise exception 'Incomplete item details'; end if;
    elsif action = 'to_group' then
      select i.item_name,i.quantity,i.description into label,stock,legacy_description from public.character_inventory i
      where (i.campaign_id,i.character_id,i.id) = (c,target,source_id) for update;
      if stock is null or stock < amount then raise exception 'Insufficient personal stock'; end if;
      select (i.details).* into details from public.character_inventory i where i.id = source_id;
      if details.category is null then
        details := row('other','common',0,0,legacy_description,false,false)::public.treasure_details;
      end if;
      if stock = amount then delete from public.character_inventory where id = source_id;
      else update public.character_inventory set quantity = stock - amount where id = source_id; end if;
    else
      select i.name,i.quantity into label,stock from public.inventory_group_contributions i
      where (i.campaign_id,i.group_id,i.id) = (c,party,source_id) for update;
      if stock is null or stock < amount then raise exception 'Insufficient group stock'; end if;
      select (i.details).* into details from public.inventory_group_contributions i where i.id = source_id;
      if stock = amount then delete from public.inventory_group_contributions where id = source_id;
      else update public.inventory_group_contributions set quantity = stock - amount where id = source_id; end if;
    end if;
    if action in ('deposit','to_group') then
      insert into public.inventory_group_contributions(campaign_id,group_id,contributed_by,category,name,quantity,details)
      values(c,party,auth.uid(),coalesce(details.category,'other'),label,amount,details);
    elsif action = 'to_character' then
      insert into public.character_inventory(campaign_id,character_id,item_name,quantity,description,details)
      values(c,target,label,amount,coalesce(details.description,''),details);
    end if;
  end if;
  perform campaign_private.record_treasury(c,party,target,session,action,label,amount,coin);
end;
$$;
revoke all on function campaign_private.move_treasure(uuid,jsonb,uuid) from public,anon,authenticated;

create function campaign_private.campaign_rework(action text, payload jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare c uuid := campaign_private.selected_campaign();
declare session uuid := (payload->>'session_id')::uuid;
declare request_key uuid := (payload->>'request_id')::uuid;
declare entry jsonb;
declare state text;
declare fields record;
declare previous_payload jsonb;
declare director boolean := campaign_private.is_campaign_director(c);
begin
  if auth.uid() is null or not campaign_private.is_campaign_member(c) then raise exception 'Campaign access required'; end if;
  if action = 'treasury' then
    if request_key is null or jsonb_typeof(payload->'movements') is distinct from 'array'
      or jsonb_array_length(payload->'movements') not between 1 and 100 then raise exception 'Invalid treasury request'; end if;
    insert into campaign_private.treasury_requests values (c,auth.uid(),request_key,payload) on conflict do nothing;
    if not found then
      select r.payload into previous_payload from campaign_private.treasury_requests r
      where (r.campaign_id,r.author_id,r.request_id) = (c,auth.uid(),request_key);
      if previous_payload is distinct from payload then raise exception 'Request ID already used'; end if;
      return;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(c::text,22));
    for entry in select value from jsonb_array_elements(payload->'movements') loop
      perform campaign_private.move_treasure(c,entry,session);
    end loop;
    return;
  end if;

  if not director then raise exception 'Director access required'; end if;
  if action = 'reputation' then
    perform campaign_private.change_reputation(c,(payload->>'organization_id')::integer,(payload->>'group_id')::integer,
      (payload->>'delta')::integer,payload->>'reason',session,(payload->>'visible')::boolean);
  elsif action = 'save_session' then
    select * into fields from jsonb_to_record(payload) as f(chapter_id uuid,title text,played_on date,
      summary text,rewards text,decisions text,consequences text,notes text);
    if session is null then
      insert into public.chronicle_sessions(campaign_id,chapter_id,title,played_on,summary,rewards,decisions,consequences)
      values(c,fields.chapter_id,fields.title,fields.played_on,fields.summary,fields.rewards,fields.decisions,fields.consequences)
      returning id into session;
    else
      update public.chronicle_sessions s set chapter_id = fields.chapter_id, title = fields.title,
        played_on = fields.played_on, summary = fields.summary, rewards = fields.rewards,
        decisions = fields.decisions, consequences = fields.consequences
      where (s.campaign_id,s.id) = (c,session);
      if not found then raise exception 'Session unavailable'; end if;
    end if;
    insert into public.chronicle_notes(campaign_id,session_id,notes) values(c,session,fields.notes)
    on conflict on constraint chronicle_notes_pkey do update set notes = excluded.notes;
    delete from public.chronicle_attendance a where (a.campaign_id,a.session_id) = (c,session);
    insert into public.chronicle_attendance(campaign_id,session_id,character_id)
    select c,session,value::integer from jsonb_array_elements_text(payload->'attendance');
    delete from public.chronicle_links l where (l.campaign_id,l.session_id) = (c,session);
    insert into public.chronicle_links(campaign_id,session_id,npc_id,organization_id,creature_id,place_id)
    select c,session,npc_id,organization_id,creature_id,place_id
    from jsonb_to_recordset(payload->'links') as l(npc_id integer,organization_id integer,creature_id integer,place_id integer);
  elsif action = 'cover' then
    perform pg_advisory_xact_lock(hashtextextended(c::text,23));
    update public.chronicle_images set cover = false where campaign_id = c and cover;
    update public.chronicle_images set cover = true where campaign_id = c and id = (payload->>'id')::uuid;
    if not found then raise exception 'Image unavailable'; end if;
  elsif action in ('publish','close') then
    select s.status into strict state from public.chronicle_sessions s
    where (s.campaign_id,s.id) = (c,session) for update;
    if state = 'closed' or (action = 'publish' and state = 'published') then return; end if;
    if action = 'close' then
      perform pg_advisory_xact_lock(hashtextextended(c::text,22));
      for entry in select value from jsonb_array_elements(coalesce(payload->'movements','[]')) loop
        perform campaign_private.move_treasure(c,entry,session);
      end loop;
      for entry in select value from jsonb_array_elements(coalesce(payload->'reputation','[]')) loop
        perform campaign_private.change_reputation(c,(entry->>'organization_id')::integer,(entry->>'group_id')::integer,
          (entry->>'delta')::integer,entry->>'reason',session,(entry->>'visible')::boolean);
      end loop;
      for entry in select value from jsonb_array_elements(coalesce(payload->'quests','[]')) loop
        update public.chronicle_quests q set status = entry->>'status', session_id = session
        where (q.campaign_id,q.id) = (c,(entry->>'id')::uuid);
        if not found then raise exception 'Quest unavailable'; end if;
      end loop;
      for entry in select value from jsonb_array_elements(coalesce(payload->'npcs','[]')) loop
        update public.allies a set alignment = entry->>'alignment'
        where (a.campaign_id,a.id) = (c,(entry->>'id')::integer);
        if not found then raise exception 'NPC unavailable'; end if;
      end loop;
    end if;
    update public.chronicle_sessions s set status = case action when 'close' then 'closed' else 'published' end
    where (s.campaign_id,s.id) = (c,session);
  else
    raise exception 'Invalid campaign action';
  end if;
end;
$$;
revoke all on function campaign_private.campaign_rework(text,jsonb) from public,anon,authenticated;
grant execute on function campaign_private.campaign_rework(text,jsonb) to authenticated;

create function public.campaign_rework(action text, payload jsonb) returns void
language sql security invoker set search_path = ''
as $$ select campaign_private.campaign_rework(action,payload); $$;
revoke all on function public.campaign_rework(text,jsonb) from public,anon,authenticated;
grant execute on function public.campaign_rework(text,jsonb) to authenticated;
