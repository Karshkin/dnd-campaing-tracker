-- Publish only the fields used to identify companions. Full character rows keep their RLS.
create function campaign_private.list_character_companions()
returns table (id integer, name varchar, race varchar, character_class varchar,
               level integer, emoji text, owner_name varchar)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, c.race, c.character_class, c.level, c.emoji, p.username
  from public.characters c
  join public.profiles p on p.id = c.user_id
  where (select auth.uid()) is not null
    and c.user_id <> (select auth.uid())
    and (select campaign_private.permitted('characters', 1));
$$;

revoke all on function campaign_private.list_character_companions() from public, anon, authenticated;
grant execute on function campaign_private.list_character_companions() to authenticated;

create function public.list_character_companions()
returns table (id integer, name varchar, race varchar, character_class varchar,
               level integer, emoji text, owner_name varchar)
language sql stable security invoker set search_path = ''
as $$ select * from campaign_private.list_character_companions(); $$;

revoke all on function public.list_character_companions() from public, anon, authenticated;
grant execute on function public.list_character_companions() to authenticated;
