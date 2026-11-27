-- Run against a disposable local database at migration 20261127165548.
-- The probe rolls back both its fixtures and the new migration.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email,raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000021','upgrade21@example.test','{"username":"Upgrade probe 21"}');
insert into public.diary_entries(title,content) values('Legacy chapter','Original <text>');
insert into public.characters(user_id,name)
values('00000000-0000-4000-8000-000000000021','Legacy character');
insert into public.character_diary(character_id,title,content)
select id,'Personal entry','Private original' from public.characters where name = 'Legacy character';
insert into public.character_inventory(character_id,item_name,quantity,description)
select id,'Legacy rope',3,'Hemp' from public.characters where name = 'Legacy character';
insert into public.organizations(name) values('Legacy faction');
insert into public.inventory_groups(name) values('Legacy party');
insert into public.inventory_group_members(group_id,user_id)
select id,'00000000-0000-4000-8000-000000000021' from public.inventory_groups where name = 'Legacy party';
insert into public.inventory_group_contributions(group_id,contributed_by,category,name,quantity)
select id,'00000000-0000-4000-8000-000000000021','coins','Old coins',12
from public.inventory_groups where name = 'Legacy party';

create temp table diary_before as select * from public.diary_entries;
create temp table personal_diary_before as select * from public.character_diary;
create temp table members_before as select * from public.inventory_group_members;
create temp table group_before as select id,group_id,contributed_by,category,name,quantity,campaign_id
from public.inventory_group_contributions;
create temp table inventory_before as select id,character_id,item_name,quantity,description,created_at,campaign_id
from public.character_inventory;

set constraints all immediate;

\ir ../migrations/20261127230127_campaign_chronicle_reputation_treasury.sql

do $$
begin
  if exists (select * from diary_before except select * from public.diary_entries)
    or exists (select * from personal_diary_before except select * from public.character_diary)
    or exists (select * from members_before except select * from public.inventory_group_members)
    or exists (select * from group_before except select id,group_id,contributed_by,category,name,quantity,campaign_id
      from public.inventory_group_contributions)
    or exists (select * from inventory_before except select id,character_id,item_name,quantity,description,created_at,campaign_id
      from public.character_inventory) then
    raise exception 'Legacy rows changed';
  end if;
  if not exists (
    select 1 from public.faction_reputation r
    join public.organizations o on o.id = r.organization_id
    join public.inventory_groups g on g.id = r.group_id
    where o.name = 'Legacy faction' and g.name = 'Legacy party' and r.score = 0 and r.visible
  ) then
    raise exception 'Existing faction/group did not start at neutral';
  end if;
end $$;

rollback;
