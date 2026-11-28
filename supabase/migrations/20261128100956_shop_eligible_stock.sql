create function campaign_private.shop_sellable(target uuid, buyer integer)
returns table(id integer,item_name text,quantity integer,unit_price bigint)
language sql stable security definer set search_path=''
as $$
  select i.id,i.item_name::text,least(i.quantity,l.remaining),least(l.paid_per_unit,p.sell_price::bigint)
  from public.shop_products p join campaign_private.shop_lots l on l.product_id=p.id
  join public.character_inventory i on i.id=l.item_id and i.campaign_id=p.campaign_id
  join public.characters ch on (ch.campaign_id,ch.id)=(i.campaign_id,i.character_id)
  where auth.uid() is not null and ch.user_id=(select auth.uid())
    and (p.campaign_id,p.id,ch.id)=(campaign_private.selected_campaign(),target,buyer)
    and campaign_private.permitted_in(p.campaign_id,'characters',2)
    and p.available and p.sell_price>0 and campaign_private.shop_open(p.campaign_id,p.shop_id)
    and lower(btrim(i.item_name))=lower(btrim(p.name)) and not coalesce((i.details).quest_item,false)
    and i.quantity>0
  order by i.item_name,i.id;
$$;
revoke all on function campaign_private.shop_sellable(uuid,integer) from public,anon,authenticated;
grant execute on function campaign_private.shop_sellable(uuid,integer) to authenticated;
create function public.shop_sellable(target uuid,buyer integer)
returns table(id integer,item_name text,quantity integer,unit_price bigint)
language sql stable security invoker set search_path=''
as $$ select * from campaign_private.shop_sellable(target,buyer); $$;
revoke all on function public.shop_sellable(uuid,integer) from public,anon,authenticated;
grant execute on function public.shop_sellable(uuid,integer) to authenticated;
