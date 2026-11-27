-- Global administrators can review any character and its diary.
create policy characters_global_admin_read
on public.characters for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_admin
  )
);

create policy character_diary_global_admin_read
on public.character_diary for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_admin
  )
);
