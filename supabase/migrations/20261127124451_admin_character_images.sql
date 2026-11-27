create policy gallery_global_admin_read
on public.character_gallery for select to authenticated
using (
  exists (select 1 from public.profiles where id = (select auth.uid()) and is_admin)
);

create policy gallery_storage_global_admin_read
on storage.objects for select to authenticated
using (
  bucket_id = 'character-gallery'
  and exists (select 1 from public.profiles where id = (select auth.uid()) and is_admin)
  and exists (select 1 from public.character_gallery g where g.object_path = storage.objects.name)
);

create policy character_portrait_global_admin_read
on storage.objects for select to authenticated
using (
  bucket_id = 'campaign-files'
  and name like 'characters/%'
  and exists (select 1 from public.profiles where id = (select auth.uid()) and is_admin)
  and exists (select 1 from public.characters c where c.image_path = storage.objects.name)
);
