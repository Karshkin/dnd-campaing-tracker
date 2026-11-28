import { useCallback, useRef, useState } from "react";
import { campaignChronicle, supabase } from "./campaign";
import { useCampaignMutation, useCampaignQuery } from "./ChronicleControls";
import { VisibilityEditor } from "./VisibilityEditor";

const coins = { cp: "Cobre", sp: "Plata", ep: "Electro", gp: "Oro", pp: "Platino" };

async function unwrap(request) {
  const { data,error } = await request;
  if (error) throw error;
  return data;
}

const artwork = () => supabase.storage.from("merchant-artwork");
const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

async function uploadArtwork(product,file) {
  const extension = extensions[file.type];
  if (!extension || !file.size || file.size > 10485760) throw new Error("Usa una imagen compatible de hasta 10 MB");
  const path = `${product.campaign_id}/${product.id}/${crypto.randomUUID()}.${extension}`;
  await unwrap(artwork().upload(path,file));
  try {
    await campaignChronicle.save("shop_products",{ artwork_path: path },product.id);
  } catch (error) {
    await artwork().remove([path]);
    throw error;
  }
  if (product.artwork_path) await artwork().remove([product.artwork_path]);
}

function ShopEditor({ shop, npcs, places, factions, busy, save, close }) {
  return <form className="form" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    save({
      name: fields.get("name"), npc_id: Number(fields.get("npc_id")) || null,
      place_id: Number(fields.get("place_id")) || null, faction_id: Number(fields.get("faction_id")) || null,
      reputation_minimum: Number(fields.get("reputation_minimum")), discount: Number(fields.get("discount")),
      available: fields.has("available"),
    });
  }}>
    <label>Nombre de tienda <input name="name" required maxLength={120} defaultValue={shop.name} /></label>
    {[["npc_id","Comerciante",npcs],["place_id","Localización",places],["faction_id","Organización de reputación",factions]].map(([key,label,rows]) =>
      <label key={key}>{label} <select name={key} defaultValue={shop[key] ?? ""}>
        <option value="">Sin vincular</option>
        {rows.map(({ id,name,title }) => <option key={id} value={id}>{name ?? title}</option>)}
      </select></label>)}
    <label>Reputación requerida <input name="reputation_minimum" type="number" min={-100} max={100} required defaultValue={shop.reputation_minimum ?? 25} /></label>
    <label>Descuento (%) <input name="discount" type="number" min={0} max={90} required defaultValue={shop.discount ?? 0} /></label>
    <label><input name="available" type="checkbox" defaultChecked={shop.available} /> Abrir al grupo</label>
    <div className="row"><button disabled={busy}>Guardar tienda</button><button type="button" onClick={close}>Cancelar</button></div>
  </form>;
}

function ProductEditor({ product, busy, save, close }) {
  return <form className="form" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    save({
      name: fields.get("name"), description: fields.get("description"), denomination: fields.get("denomination"),
      price: Number(fields.get("price")), sell_price: Number(fields.get("sell_price")), stock: Number(fields.get("stock")),
      available: fields.has("available"),
    });
  }}>
    <label>Artículo <input name="name" required maxLength={120} defaultValue={product.name} /></label>
    <label>Descripción <textarea name="description" maxLength={5000} defaultValue={product.description} /></label>
    <div className="chronicle-actions">
      <label>Moneda <select name="denomination" defaultValue={product.denomination ?? "gp"}>
        {Object.entries(coins).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>Precio de venta <input name="price" type="number" min={1} max={1000000} required defaultValue={product.price ?? 1} /></label>
      <label>Precio máximo de recompra <input name="sell_price" type="number" min={0} max={1000000} required defaultValue={product.sell_price ?? 0} /></label>
      <label>Existencias <input name="stock" type="number" min={0} max={1000000000} required defaultValue={product.stock ?? 0} /></label>
    </div>
    <label><input name="available" type="checkbox" defaultChecked={product.available ?? true} /> Disponible</label>
    <div className="row"><button disabled={busy}>Guardar producto</button><button type="button" onClick={close}>Cancelar</button></div>
  </form>;
}

function Trade({ product, traders, onChange }) {
  const [character,setCharacter] = useState("");
  const [mode,setMode] = useState("buy");
  const [receipt,setReceipt] = useState(null);
  const retry = useRef(null);
  const loadInventory = useCallback(async () => {
    if (!character || mode !== "sell") return [];
    return unwrap(supabase.rpc("shop_sellable",{ target: product.id, buyer: Number(character) }));
  },[character,mode,product.id]);
  const inventory = useCampaignQuery(loadInventory);
  const mutation = useCampaignMutation(async () => { await inventory.refresh(); await onChange(); });
  const eligible = inventory.data ?? [];
  return <form className="chronicle-flow" onSubmit={async (event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const units = Number(fields.get("units"));
    const params = {
      target: product.id, buyer: Number(character), action: mode, units,
      item: mode === "sell" ? Number(fields.get("item")) : null,
      ceiling: mode === "buy" ? product.price*units : Number(fields.get("minimum")),
    };
    const signature = JSON.stringify(params);
    if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() };
    if (await mutation.run(async () => {
      setReceipt(await unwrap(supabase.rpc("trade_at_shop", { request_id: retry.current.id, ...params })));
    })) retry.current = null;
  }}>
    <div className="chronicle-actions">
      <label>Personaje <select required value={character} onChange={(event) => setCharacter(event.target.value)}>
        <option value="">Seleccionar</option>
        {traders.map(({ id,name }) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Operación <select value={mode} onChange={(event) => setMode(event.target.value)}>
        <option value="buy">Comprar</option>
        {product.sell_price > 0 && <option value="sell">Vender a la tienda</option>}
      </select></label>
      {mode === "sell" && <>
        <label>Objeto <select name="item" required defaultValue="">
          <option value="">Seleccionar</option>
          {eligible.map(({ id,item_name,quantity,unit_price }) => <option key={id} value={id}>
            {item_name} × {quantity} · {unit_price} {coins[product.denomination]} por unidad
          </option>)}
        </select></label>
        <label>Ingreso mínimo aceptado <input name="minimum" type="number" min={1} required defaultValue={1} /></label>
      </>}
      <label>Cantidad <input name="units" type="number" min={1} max={mode === "buy" ? Math.max(1, Math.min(product.stock,10000)) : 10000} required defaultValue={1} /></label>
      <button disabled={mutation.busy || !character || (mode === "buy" && !product.stock)}>Confirmar {mode === "buy" ? "compra" : "venta"}</button>
    </div>
    {(inventory.error || mutation.error) && <p role="alert">{inventory.error || mutation.error}</p>}
    {receipt && <p role="status">Operación registrada · {receipt.total} {coins[receipt.denomination]}</p>}
  </form>;
}

export function Merchants({ director, traders, characters, npcs, factions }) {
  const [selected,setSelected] = useState(null);
  const [shopDraft,setShopDraft] = useState(null);
  const [productDraft,setProductDraft] = useState(null);
  const load = useCallback(async () => {
    const [shops,products,history,places] = await Promise.all([
      campaignChronicle.list("campaign_shops","name"),
      campaignChronicle.list("shop_products","name"),
      unwrap(supabase.from("shop_transactions").select().order("created_at", { ascending: false }).limit(50)),
      campaignChronicle.list("points_of_interest","title"),
    ]);
    const paths = products.map(({ artwork_path }) => artwork_path).filter(Boolean);
    const urls = paths.length ? await unwrap(artwork().createSignedUrls(paths,60)) : [];
    const signed = new Map(urls.map(({ path,signedUrl }) => [path,signedUrl]));
    return { shops,products: products.map((product) => ({ ...product, image: signed.get(product.artwork_path) })),history,places };
  },[]);
  const { data,error,refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  const shop = data?.shops.find(({ id }) => id === selected);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando comercios…</p>;
  return <section className="chronicle-flow">
    <h2>Tiendas y comerciantes</h2>
    {mutation.error && <p role="alert">{mutation.error}</p>}
    <div className="chronicle-actions">
      <label>Tienda <select value={selected ?? ""} onChange={(event) => {
        setSelected(event.target.value); setShopDraft(null); setProductDraft(null);
      }}>
        <option value="">Seleccionar tienda</option>
        {data.shops.map(({ id,name }) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      {director && <button type="button" onClick={() => setShopDraft({})}>Crear tienda</button>}
    </div>
    {shopDraft && <ShopEditor key={shopDraft.id ?? "new"} shop={shopDraft} npcs={npcs} places={data.places} factions={factions}
      close={() => setShopDraft(null)} busy={mutation.busy} save={async (fields) => {
        if (await mutation.run(async () => {
          const row = await campaignChronicle.save("campaign_shops",fields,shopDraft.id);
          setSelected(row.id);
        })) setShopDraft(null);
      }} />}
    {shop && <section className="chronicle-panel chronicle-flow">
      <h3>{shop.name}</h3>
      <p>{[npcs.find(({ id }) => id === shop.npc_id)?.name, data.places.find(({ id }) => id === shop.place_id)?.title]
        .filter(Boolean).join(" · ")}</p>
      {shop.discount > 0 && <p>Descuento de {shop.discount}% para grupos con reputación suficiente.</p>}
      {director && <>
        <VisibilityEditor kind="campaign_shops" id={shop.id} characters={characters} />
        <div className="row">
          <button type="button" onClick={() => setShopDraft(shop)}>Editar tienda</button>
          <button type="button" onClick={() => setProductDraft({})}>Añadir producto</button>
        </div>
      </>}
      {productDraft && <ProductEditor key={productDraft.id ?? "new"} product={productDraft} close={() => setProductDraft(null)}
        busy={mutation.busy} save={async (fields) => {
          if (await mutation.run(() => campaignChronicle.save("shop_products",productDraft.id ? fields : { ...fields,shop_id: shop.id },productDraft.id))) {
            setProductDraft(null);
          }
        }} />}
      <ul className="chronicle-list">{data.products.filter(({ shop_id }) => shop_id === shop.id).map((product) => <li className="chronicle-panel" key={product.id}>
        <h4>{product.name}</h4>
        {product.image && <img className="merchant-product-image" src={product.image} alt={product.name} width={120} height={120}
          style={{ objectFit: "cover" }} />}
        <p>{product.description}</p>
        <p>{product.price} {coins[product.denomination]} · {product.stock} en existencias
          {product.sell_price > 0 && ` · Recompra de lotes propios hasta ${product.sell_price} ${coins[product.denomination]}`}</p>
        {director && <div className="row">
          <button type="button" onClick={() => setProductDraft(product)}>Editar producto</button>
          <label>Imagen del producto <input type="file" accept={Object.keys(extensions).join(",")} disabled={mutation.busy}
            onChange={(event) => {
              const file = event.target.files[0];
              event.target.value = "";
              if (file) mutation.run(() => uploadArtwork(product,file));
            }} /></label>
        </div>}
        {shop.available && product.available && traders.length > 0 && <Trade product={product} traders={traders} onChange={refresh} />}
      </li>)}</ul>
    </section>}
    <details><summary>Historial de operaciones</summary>
      <ul>{data.history.map((row) => <li key={row.id}>{row.operation === "buy" ? "Compra" : "Venta"} · {row.quantity} × {row.product_name} · {row.total} {coins[row.denomination]}</li>)}</ul>
    </details>
  </section>;
}
