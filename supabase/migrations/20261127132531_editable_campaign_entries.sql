grant update (name, creature_type, challenge_rating, armor_class, hit_points, speed,
              abilities, weaknesses, resistances, immunities, notes)
on public.creatures to authenticated;

grant update (name, role, location, relationship, notes, organization_id)
on public.allies to authenticated;

grant update (name, description) on public.organizations to authenticated;

create table public.campaign_entry_images (
  id integer generated always as identity primary key,
  creature_id integer references public.creatures(id) on delete cascade,
  ally_id integer references public.allies(id) on delete cascade,
  organization_id integer references public.organizations(id) on delete cascade,
  object_path text not null unique,
  entry_section text generated always as (
    case when creature_id is not null then 'bestiary'
         when ally_id is not null then 'npcs'
         else 'organizations' end
  ) stored,
  check (num_nonnulls(creature_id, ally_id, organization_id) = 1),
  check (object_path ~ (
    '^' || case when creature_id is not null then 'bestiary'
                when ally_id is not null then 'npcs'
                else 'organizations' end ||
    '/' || coalesce(creature_id, ally_id, organization_id)::text ||
    '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'
  ))
);

create index campaign_entry_images_creature_idx on public.campaign_entry_images (creature_id, id) where creature_id is not null;
create index campaign_entry_images_ally_idx on public.campaign_entry_images (ally_id, id) where ally_id is not null;
create index campaign_entry_images_org_idx on public.campaign_entry_images (organization_id, id) where organization_id is not null;

alter table public.campaign_entry_images enable row level security;
revoke all on public.campaign_entry_images from public, anon, authenticated;
grant select, insert (creature_id, ally_id, organization_id, object_path), delete on public.campaign_entry_images to authenticated;
grant usage on sequence public.campaign_entry_images_id_seq to authenticated;

create policy campaign_entry_images_read on public.campaign_entry_images
for select to authenticated
using (campaign_private.permitted(entry_section, 1));

create policy campaign_entry_images_insert on public.campaign_entry_images
for insert to authenticated
with check (campaign_private.permitted(entry_section, 2));

create policy campaign_entry_images_delete on public.campaign_entry_images
for delete to authenticated
using (campaign_private.permitted(entry_section, 2));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-entry-images', 'campaign-entry-images', false, 20971520,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/tiff']);

create policy campaign_entry_storage_read on storage.objects
for select to authenticated
using (
  bucket_id = 'campaign-entry-images'
  and split_part(name, '/', 1) in ('bestiary', 'npcs', 'organizations')
  and (
    campaign_private.permitted(split_part(name, '/', 1), 2)
    or exists (select 1 from public.campaign_entry_images i where i.object_path = storage.objects.name)
  )
);

create policy campaign_entry_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'campaign-entry-images'
  and campaign_private.permitted(split_part(name, '/', 1), 2)
  and name ~ '^(bestiary|npcs|organizations)/[1-9][0-9]*/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$'
  and case split_part(name, '/', 1)
    when 'bestiary' then exists (select 1 from public.creatures c where c.id::text = split_part(storage.objects.name, '/', 2))
    when 'npcs' then exists (select 1 from public.allies a where a.id::text = split_part(storage.objects.name, '/', 2))
    when 'organizations' then exists (select 1 from public.organizations o where o.id::text = split_part(storage.objects.name, '/', 2))
    else false
  end
);

create policy campaign_entry_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'campaign-entry-images'
  and split_part(name, '/', 1) in ('bestiary', 'npcs', 'organizations')
  and campaign_private.permitted(split_part(name, '/', 1), 2)
  and not exists (select 1 from public.campaign_entry_images i where i.object_path = storage.objects.name)
);
