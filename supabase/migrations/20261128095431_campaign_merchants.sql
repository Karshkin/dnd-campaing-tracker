create table public.campaign_shops (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign() references public.campaigns on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  npc_id integer,
  place_id integer,
  faction_id integer,
  reputation_minimum integer not null default 25 check (reputation_minimum between -100 and 100),
  discount integer not null default 0 check (discount between 0 and 90),
  available boolean not null default false,
  unique(campaign_id,id),
  foreign key(campaign_id,npc_id) references public.allies(campaign_id,id) on delete set null(npc_id),
  foreign key(campaign_id,place_id) references public.points_of_interest(campaign_id,id) on delete set null(place_id),
  foreign key(campaign_id,faction_id) references public.organizations(campaign_id,id) on delete set null(faction_id)
);
create index campaign_shops_by_campaign on public.campaign_shops(campaign_id,name);
create table public.shop_products (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default campaign_private.selected_campaign(),
  shop_id uuid not null,
  name text not null check(length(btrim(name)) between 1 and 120),
  description text not null default '' check(length(description) <= 5000),
  denomination public.coin_denomination not null default 'gp',
  price integer not null check(price between 1 and 1000000),
  sell_price integer not null default 0 check(sell_price between 0 and price),
  stock integer not null default 0 check(stock between 0 and 1000000000),
  available boolean not null default true,
  foreign key(campaign_id,shop_id) references public.campaign_shops(campaign_id,id) on delete cascade
);
create index shop_products_by_shop on public.shop_products(campaign_id,shop_id,name);
create table public.shop_transactions (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns on delete cascade,
  shop_id uuid not null,
  product_id uuid not null,
  author_id uuid not null,
  character_id integer not null,
  item_id integer,
  operation text not null check(operation in ('buy','sell')),
  quantity integer not null,
  total bigint not null,
  denomination public.coin_denomination not null,
  product_name text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index shop_transactions_by_campaign on public.shop_transactions(campaign_id,created_at desc);
create index shop_transactions_by_author on public.shop_transactions(campaign_id,author_id,created_at desc);
insert into campaign_private.visibility_entities values('campaign_shops','public.campaign_shops');

create function campaign_private.shop_open(c uuid,target uuid) returns boolean
language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null and campaign_private.permitted_in(c,'tracker',1) and exists (
    select 1 from public.campaign_shops s where (s.campaign_id,s.id)=(c,target) and s.available
    and campaign_private.can_discover(c,'campaign_shops',s.id::text)
    and (s.npc_id is null or campaign_private.can_discover(c,'allies',s.npc_id::text))
    and (s.place_id is null or exists(select 1 from public.points_of_interest p
      where (p.campaign_id,p.id)=(c,s.place_id)
        and campaign_private.can_discover(c,'points_of_interest',p.id::text)
        and (p.map_id is null or campaign_private.can_discover(c,'maps',p.map_id::text))))
    and (s.faction_id is null or campaign_private.can_discover(c,'organizations',s.faction_id::text))
  );
$$;
revoke all on function campaign_private.shop_open(uuid,uuid) from public,anon,authenticated;
grant execute on function campaign_private.shop_open(uuid,uuid) to authenticated;

alter table public.campaign_shops enable row level security;
alter table public.shop_products enable row level security;
alter table public.shop_transactions enable row level security;
revoke all on public.campaign_shops,public.shop_products,public.shop_transactions from public,anon,authenticated;
grant select,delete,insert(name,npc_id,place_id,faction_id,reputation_minimum,discount,available),
  update(name,npc_id,place_id,faction_id,reputation_minimum,discount,available) on public.campaign_shops to authenticated;
grant select,delete,insert(shop_id,name,description,denomination,price,sell_price,stock,available),
  update(name,description,denomination,price,sell_price,stock,available) on public.shop_products to authenticated;
grant select on public.shop_transactions to authenticated;
create policy shop_read on public.campaign_shops for select to authenticated
using (campaign_id=(select campaign_private.selected_campaign()) and campaign_private.shop_open(campaign_id,id));
create policy shop_admin on public.campaign_shops for all to authenticated
using (campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id))
with check (campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id));
create policy product_read on public.shop_products for select to authenticated
using (campaign_id=(select campaign_private.selected_campaign()) and available and campaign_private.shop_open(campaign_id,shop_id));
create policy product_admin on public.shop_products for all to authenticated
using (campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id))
with check (campaign_id=(select campaign_private.selected_campaign()) and campaign_private.is_campaign_director(campaign_id));
create policy shop_audit_read on public.shop_transactions for select to authenticated
using (campaign_id=(select campaign_private.selected_campaign()) and
  (campaign_private.is_campaign_director(campaign_id) or
    (author_id=(select auth.uid()) and campaign_private.permitted_in(campaign_id,'tracker',1))));

-- Personal inventories allow manual entries. Only shop-issued lots can be redeemed for coins.
create table campaign_private.shop_lots (
  item_id integer primary key references public.character_inventory(id) on delete cascade,
  product_id uuid not null references public.shop_products(id) on delete cascade,
  remaining integer not null check(remaining > 0),
  paid_per_unit bigint not null check(paid_per_unit > 0)
);
alter table campaign_private.shop_lots enable row level security;
revoke all on campaign_private.shop_lots from public,anon,authenticated;

create function campaign_private.trade_at_shop(request_id uuid, target uuid, buyer integer, action text, units integer, item integer, ceiling bigint)
returns public.shop_transactions language plpgsql security definer set search_path=''
as $$
declare c uuid := campaign_private.selected_campaign();
declare actor uuid := auth.uid();
declare product public.shop_products;
declare shop public.campaign_shops;
declare receipt public.shop_transactions;
declare owned public.character_inventory;
declare amount bigint;
declare reduction integer := 0;
declare received integer;
declare lot campaign_private.shop_lots;
begin
  if actor is null or not campaign_private.permitted_in(c,'characters',2)
    or not campaign_private.permitted_in(c,'tracker',1) then raise exception 'Permiso de comercio requerido'; end if;
  if request_id is null or units is null or units not between 1 and 10000 or action is null or action not in ('buy','sell')
    or (action = 'sell') <> (item is not null) then raise exception 'Operación inválida'; end if;

  perform pg_advisory_xact_lock(hashtextextended(request_id::text, 32));
  select * into receipt from public.shop_transactions where id=request_id;
  if found then
    if (receipt.campaign_id,receipt.author_id,receipt.product_id,receipt.character_id,receipt.operation,receipt.quantity)
       is distinct from (c,actor,target,buyer,action,units) or receipt.item_id is distinct from item then
      raise exception 'Solicitud incompatible';
    end if;
    return receipt;
  end if;

  perform 1 from public.characters ch where (ch.campaign_id,ch.id,ch.user_id)=(c,buyer,actor) for key share;
  if not found then raise exception 'Selecciona un personaje propio'; end if;
  select p.* into product from public.shop_products p where (p.campaign_id,p.id)=(c,target) and p.available for update;
  if not found then raise exception 'Producto no disponible'; end if;
  select s.* into shop from public.campaign_shops s where (s.campaign_id,s.id)=(c,product.shop_id) for share;
  if not found or not campaign_private.shop_open(c,shop.id) then raise exception 'Tienda no disponible'; end if;

  if action = 'buy' then
    if product.stock < units then raise exception 'Existencias insuficientes'; end if;
    if exists (select 1 from public.faction_reputation r join public.inventory_group_members m
      on (m.campaign_id,m.group_id)=(r.campaign_id,r.group_id)
      join public.inventory_groups g on (g.campaign_id,g.id)=(r.campaign_id,r.group_id)
      where r.campaign_id=c and r.organization_id=shop.faction_id and r.visible and r.score>=shop.reputation_minimum
        and m.user_id=actor and g.archived_at is null) then
      reduction := shop.discount;
    end if;
    amount := greatest(1,ceil(product.price::numeric*(100-reduction)/100))::bigint*units;
    if ceiling is null or amount > ceiling then raise exception 'El precio ha cambiado'; end if;
    perform campaign_private.change_wallet(c,null,buyer,product.denomination,-amount);
    update public.shop_products set stock=stock-units where id=product.id;
    insert into public.character_inventory(campaign_id,character_id,item_name,quantity,description)
      values(c,buyer,product.name,units,product.description) returning id into received;
    insert into campaign_private.shop_lots(item_id,product_id,remaining,paid_per_unit)
    values(received,target,units,amount/units);
  else
    if product.sell_price = 0 then raise exception 'Esta tienda no compra el producto'; end if;
    select * into owned from public.character_inventory i
      where (i.campaign_id,i.character_id,i.id)=(c,buyer,item) for update;
    if not found or owned.quantity < units or lower(btrim(owned.item_name)) <> lower(btrim(product.name))
      or coalesce((owned.details).quest_item,false) then raise exception 'Objeto no disponible para venta'; end if;
    select * into lot from campaign_private.shop_lots l where (l.item_id,l.product_id)=(item,target) for update;
    if not found or lot.remaining < units then raise exception 'Solo se recompran unidades vendidas por esta tienda'; end if;
    amount := least(product.sell_price,lot.paid_per_unit)*units;
    if ceiling is null or amount < ceiling then raise exception 'El precio ha cambiado'; end if;
    if lot.remaining = units then delete from campaign_private.shop_lots where item_id=item;
    else update campaign_private.shop_lots set remaining=remaining-units where item_id=item; end if;
    if owned.quantity = units then delete from public.character_inventory where id=owned.id;
    else update public.character_inventory set quantity=quantity-units where id=owned.id; end if;
    update public.shop_products set stock=stock+units where id=product.id;
    perform campaign_private.change_wallet(c,null,buyer,product.denomination,amount);
  end if;
  insert into public.shop_transactions(id,campaign_id,shop_id,product_id,author_id,character_id,item_id,
                                    operation,quantity,total,denomination,product_name)
  values(request_id,c,shop.id,target,actor,buyer,item,action,units,amount,product.denomination,product.name)
  returning * into receipt;
  return receipt;
end;
$$;
revoke all on function campaign_private.trade_at_shop(uuid,uuid,integer,text,integer,integer,bigint) from public,anon,authenticated;
grant execute on function campaign_private.trade_at_shop(uuid,uuid,integer,text,integer,integer,bigint) to authenticated;

create function public.trade_at_shop(request_id uuid,target uuid,buyer integer,action text,units integer,item integer,ceiling bigint)
returns public.shop_transactions language sql security invoker set search_path=''
as $$ select campaign_private.trade_at_shop(request_id,target,buyer,action,units,item,ceiling); $$;
revoke all on function public.trade_at_shop(uuid,uuid,integer,text,integer,integer,bigint) from public,anon,authenticated;
grant execute on function public.trade_at_shop(uuid,uuid,integer,text,integer,integer,bigint) to authenticated;

alter table public.shop_products add column artwork_path text
  check(artwork_path is null or artwork_path ~ ('^'||campaign_id::text||'/'||id::text||'/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$'));
grant update(artwork_path) on public.shop_products to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('merchant-artwork','merchant-artwork',false,10485760,array['image/png','image/jpeg','image/webp','image/gif','image/avif']);

create function campaign_private.shop_artwork_access(path text,editor boolean) returns boolean
language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.shop_products p
    where p.campaign_id::text=split_part(path,'/',1) and p.id::text=split_part(path,'/',2)
      and path ~ ('^'||p.campaign_id::text||'/'||p.id::text||'/[0-9a-f-]{36}\.(png|jpg|webp|gif|avif)$')
      and (campaign_private.is_campaign_director(p.campaign_id) or
        (not editor and p.artwork_path=path and p.available and campaign_private.shop_open(p.campaign_id,p.shop_id)))
  );
$$;
revoke all on function campaign_private.shop_artwork_access(text,boolean) from public,anon,authenticated;
grant execute on function campaign_private.shop_artwork_access(text,boolean) to authenticated;
create policy merchant_artwork_read on storage.objects for select to authenticated
using(bucket_id='merchant-artwork' and campaign_private.shop_artwork_access(name,false));
create policy merchant_artwork_insert on storage.objects for insert to authenticated
with check(bucket_id='merchant-artwork' and campaign_private.shop_artwork_access(name,true));
create policy merchant_artwork_delete on storage.objects for delete to authenticated
using(bucket_id='merchant-artwork' and campaign_private.shop_artwork_access(name,true));
create policy merchant_artwork_read_guard on storage.objects as restrictive for select to authenticated
using(bucket_id<>'merchant-artwork' or campaign_private.shop_artwork_access(name,false));
create policy merchant_artwork_insert_guard on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'merchant-artwork' or campaign_private.shop_artwork_access(name,true));
create policy merchant_artwork_delete_guard on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'merchant-artwork' or campaign_private.shop_artwork_access(name,true));
create policy merchant_artwork_update_guard on storage.objects as restrictive for update to authenticated
using(bucket_id<>'merchant-artwork') with check(bucket_id<>'merchant-artwork');
