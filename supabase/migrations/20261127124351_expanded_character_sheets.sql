alter table public.characters
  add column emoji text not null default '' check (char_length(emoji) <= 16),
  add column background text not null default '' check (char_length(background) <= 4000),
  add column equipment text not null default '' check (char_length(equipment) <= 4000),
  add column abilities text not null default '' check (char_length(abilities) <= 4000),
  add column appearance text not null default '' check (char_length(appearance) <= 4000),
  add column personality text not null default '' check (char_length(personality) <= 4000),
  add column goals text not null default '' check (char_length(goals) <= 4000);

grant insert (emoji, background, equipment, abilities, appearance, personality, goals),
      update (emoji, background, equipment, abilities, appearance, personality, goals)
on public.characters to authenticated;

create table public.character_gallery (
  id integer generated always as identity primary key,
  character_id integer not null references public.characters(id) on delete cascade,
  object_path text not null unique,
  created_at timestamptz not null default now()
);
create index character_gallery_character_id_idx on public.character_gallery (character_id);
alter table public.character_gallery enable row level security;
revoke all on public.character_gallery from public, anon, authenticated;
grant select, insert (character_id, object_path), delete on public.character_gallery to authenticated;
grant usage on sequence public.character_gallery_id_seq to authenticated;

create policy gallery_owner_read on public.character_gallery for select to authenticated
using (exists (select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid())));

create policy gallery_owner_insert on public.character_gallery for insert to authenticated
with check (
  (select campaign_private.permitted('characters', 2))
  and exists (select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid()))
  and object_path ~ ('^' || (select auth.uid())::text || '/' || character_id::text
    || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$')
);

create policy gallery_owner_delete on public.character_gallery for delete to authenticated
using (
  (select campaign_private.permitted('characters', 2))
  and exists (select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid()))
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-gallery', 'character-gallery', false, 20971520,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/tiff']);

create policy gallery_storage_read on storage.objects for select to authenticated
using (
  bucket_id = 'character-gallery'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and (
    (select campaign_private.permitted('characters', 2))
    or exists (select 1 from public.character_gallery g where g.object_path = name)
  )
);

create policy gallery_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'character-gallery'
  and (select campaign_private.permitted('characters', 2))
  and exists (
    select 1 from public.characters c
    where c.user_id = (select auth.uid())
      and storage.objects.name ~ ('^' || c.user_id::text || '/' || c.id::text
        || '/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$')
  )
);

create policy gallery_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'character-gallery'
  and (select campaign_private.permitted('characters', 2))
  and split_part(name, '/', 1) = (select auth.uid())::text
  and not exists (select 1 from public.character_gallery g where g.object_path = name)
);
