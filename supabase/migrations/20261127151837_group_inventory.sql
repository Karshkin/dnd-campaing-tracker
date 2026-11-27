create table public.inventory_groups (
  id integer generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 100)
);
create unique index inventory_groups_name_unique on public.inventory_groups (lower(btrim(name)));

create table public.inventory_group_members (
  group_id integer references public.inventory_groups(id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles(id) on delete cascade,
  primary key (group_id, user_id)
);
create index inventory_group_members_user_idx on public.inventory_group_members (user_id, group_id);

create table public.inventory_group_contributions (
  id integer generated always as identity primary key,
  group_id integer not null references public.inventory_groups(id) on delete cascade,
  contributed_by uuid default auth.uid() references public.profiles(id) on delete set null,
  category text not null check (category in ('coins', 'equipment', 'consumables', 'materials', 'other')),
  name text not null check (length(btrim(name)) between 1 and 120),
  quantity integer not null check (quantity between 1 and 1000000000)
);
create index inventory_group_contributions_group_idx on public.inventory_group_contributions (group_id, category, id);
create index inventory_group_contributions_author_idx on public.inventory_group_contributions (contributed_by);

alter table public.inventory_groups enable row level security;
alter table public.inventory_group_members enable row level security;
alter table public.inventory_group_contributions enable row level security;
revoke all on public.inventory_groups, public.inventory_group_members, public.inventory_group_contributions
from public, anon, authenticated;

grant select, insert (name) on public.inventory_groups to authenticated;
grant select, insert (group_id), delete on public.inventory_group_members to authenticated;
grant select, insert (group_id, category, name, quantity), update (quantity), delete
on public.inventory_group_contributions to authenticated;
grant usage on sequence public.inventory_groups_id_seq, public.inventory_group_contributions_id_seq to authenticated;

create policy inventory_groups_read on public.inventory_groups for select to authenticated
using ((select campaign_private.permitted('tracker', 1)));
create policy inventory_groups_create on public.inventory_groups for insert to authenticated
with check ((select campaign_private.permitted('tracker', 1)));

create policy inventory_members_read on public.inventory_group_members for select to authenticated
using (user_id = (select auth.uid()) and (select campaign_private.permitted('tracker', 1)));
create policy inventory_members_join on public.inventory_group_members for insert to authenticated
with check (user_id = (select auth.uid()) and (select campaign_private.permitted('tracker', 1)));
create policy inventory_members_leave on public.inventory_group_members for delete to authenticated
using (user_id = (select auth.uid()));

create policy inventory_contributions_read on public.inventory_group_contributions for select to authenticated
using (group_id in (select m.group_id from public.inventory_group_members m where m.user_id = (select auth.uid())));
create policy inventory_contributions_add on public.inventory_group_contributions for insert to authenticated
with check (contributed_by = (select auth.uid())
  and group_id in (select m.group_id from public.inventory_group_members m where m.user_id = (select auth.uid())));
create policy inventory_contributions_edit on public.inventory_group_contributions for update to authenticated
using (contributed_by = (select auth.uid())
  and group_id in (select m.group_id from public.inventory_group_members m where m.user_id = (select auth.uid())))
with check (contributed_by = (select auth.uid())
  and group_id in (select m.group_id from public.inventory_group_members m where m.user_id = (select auth.uid())));
create policy inventory_contributions_remove on public.inventory_group_contributions for delete to authenticated
using (contributed_by = (select auth.uid())
  and group_id in (select m.group_id from public.inventory_group_members m where m.user_id = (select auth.uid())));

create function public.create_inventory_group(group_name text)
returns integer language plpgsql security invoker set search_path = ''
as $$
declare new_group_id integer;
begin
  insert into public.inventory_groups (name) values (btrim(group_name)) returning id into new_group_id;
  insert into public.inventory_group_members (group_id) values (new_group_id);
  return new_group_id;
end;
$$;
revoke all on function public.create_inventory_group(text) from public, anon, authenticated;
grant execute on function public.create_inventory_group(text) to authenticated;

create view public.inventory_group_totals with (security_invoker = true) as
select group_id, category,
       lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) as item_key,
       min(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) as name,
       sum(quantity) as quantity
from public.inventory_group_contributions
group by group_id, category, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'));
revoke all on public.inventory_group_totals from public, anon, authenticated;
grant select on public.inventory_group_totals to authenticated;
