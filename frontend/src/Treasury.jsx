import { useCallback, useRef, useState } from "react";
import { campaignChronicle, treasury } from "./campaign";
import { SelectRow, useCampaignMutation, useCampaignQuery } from "./ChronicleControls";

export const denominations = { cp: "Cobre", sp: "Plata", ep: "Electro", gp: "Oro", pp: "Platino" };
const categories = { equipment: "Equipo", consumables: "Consumibles", materials: "Materiales", other: "Otros", coins: "Monedas (legado)" };
const rarities = { common: "Común", uncommon: "Poco común", rare: "Raro", very_rare: "Muy raro", legendary: "Legendario", artifact: "Artefacto" };
const operations = {
  deposit: "Ingreso", withdraw: "Retirada", consume: "Consumo", to_group: "De personaje a grupo",
  to_character: "De grupo a personaje", distribution: "Reparto", correction: "Corrección",
};
const asRows = (labels) => Object.entries(labels).map(([id, name]) => ({ id, name }));
const blankDetails = { category: "equipment", rarity: "common", weight: 0, value_gp: 0, description: "", quest_item: false, unidentified: false };

export function Wallet({ rows }) {
  return <dl className="treasury-wallet">{Object.entries(denominations).map(([key, label]) => (
    <div key={key}><dt>{label}</dt><dd>{rows.find(({ denomination }) => denomination === key)?.balance ?? 0}</dd></div>
  ))}</dl>;
}

export function ItemDetails({ details }) {
  if (!details) return null;
  return <span> · {rarities[details.rarity]} · {details.weight} lb · {details.value_gp} po
    {details.quest_item && " · Objeto de misión"}{details.unidentified && " · Sin identificar"}
    {details.description && <> · {details.description}</>}
  </span>;
}

export function MovementEditor({ groupId, characters, items, busy, onAdd, closure = false }) {
  const [operation, setOperation] = useState(closure ? "distribution" : "deposit");
  const [currency, setCurrency] = useState(closure ? "gp" : "");
  const [character, setCharacter] = useState("");
  const [item, setItem] = useState("");
  const [details, setDetails] = useState(blankDetails);
  const load = useCallback(() => character && operation === "to_group" ? treasury.personal(character) : null, [character, operation]);
  const personal = useCampaignQuery(load);
  const transfer = ["to_group", "to_character", "distribution"].includes(operation);
  const source = operation === "to_group" ? personal.data?.[0] ?? [] : items;
  const coinOptions = asRows(denominations);
  const operationOptions = closure
    ? { distribution: operations.distribution, to_character: operations.to_character }
    : Object.fromEntries(Object.entries(operations).filter(([key]) => key !== "correction"));

  function setDetail(event) {
    const input = event.target;
    const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
    setDetails((previous) => ({ ...previous, [input.name]: value }));
  }

  return <form className="form" onSubmit={async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (await onAdd({
      group_id: groupId, operation, quantity: Number(fields.get("quantity")), denomination: currency || null,
      character_id: transfer ? Number(character) : null, item_id: currency ? null : Number(item) || null,
      name: fields.get("name"), details,
    })) {
      setItem("");
      setDetails(blankDetails);
      form.elements.quantity.value = "1";
      if (form.elements.name) form.elements.name.value = "";
    }
  }}>
    <SelectRow label="Operación" rows={asRows(operationOptions)} value={operation} onChange={(value) => {
      setOperation(value);
      setItem("");
      if (value === "distribution" && !currency) setCurrency("gp");
    }} />
    <SelectRow label="Tipo" rows={coinOptions} value={currency} onChange={setCurrency}
      empty={operation === "distribution" ? undefined : "Objeto"} />
    {transfer && <SelectRow label="Personaje" rows={characters} value={character}
      onChange={(value) => { setCharacter(value); setItem(""); }} empty="Selecciona un personaje" required />}
    {operation === "to_group" && personal.error && <p role="alert">{personal.error}</p>}
    {operation === "to_group" && currency && personal.data && <Wallet rows={personal.data[1]} />}
    {!currency && (operation === "deposit" ? <>
      <label>Nombre <input name="name" maxLength={120} required /></label>
      <div className="chronicle-actions">
        <SelectRow label="Categoría" rows={asRows(categories).filter(({ id }) => id !== "coins")} value={details.category}
          onChange={(category) => setDetails({ ...details, category })} />
        <SelectRow label="Rareza" rows={asRows(rarities)} value={details.rarity}
          onChange={(rarity) => setDetails({ ...details, rarity })} />
        <label>Peso unitario (lb) <input name="weight" type="number" min="0" step="any" value={details.weight} onChange={setDetail} /></label>
        <label>Valor unitario (po) <input name="value_gp" type="number" min="0" step="any" value={details.value_gp} onChange={setDetail} /></label>
      </div>
      <label>Descripción <textarea name="description" value={details.description} onChange={setDetail} /></label>
      <div className="chronicle-actions">
        <label>Objeto de misión <input name="quest_item" type="checkbox" checked={details.quest_item} onChange={setDetail} /></label>
        <label>Sin identificar <input name="unidentified" type="checkbox" checked={details.unidentified} onChange={setDetail} /></label>
      </div>
    </> : <SelectRow label="Objeto" rows={source.map((row) => ({ ...row, name: `${row.name ?? row.item_name} × ${row.quantity}` }))}
      value={item} onChange={setItem} empty="Selecciona un objeto" required />)}
    <label>Cantidad <input name="quantity" type="number" min="1" max="1000000000" defaultValue="1" required /></label>
    <button disabled={busy || (transfer && !character)}>{closure || operation === "distribution" ? "Añadir al reparto" : "Registrar movimiento"}</button>
  </form>;
}

export function ItemArtwork({ path, name }) {
  const load = useCallback(() => treasury.artwork(path), [path]);
  const { data } = useCampaignQuery(load);
  return data ? <a href={data} target="_blank" rel="noreferrer" aria-label={`Ampliar imagen de ${name}`}>
    <img className="treasure-thumbnail" src={data} alt={name} loading="lazy" />
  </a> : <span className="treasure-thumbnail treasure-placeholder" aria-hidden="true">◇</span>;
}

export function Treasury({ groupId, characters, revision, onMove, director, userId, archived }) {
  const load = useCallback(async () => {
    const [contents, sessions] = await Promise.all([
      treasury.contents(groupId), campaignChronicle.list("chronicle_sessions", "played_on"),
    ]);
    return { ...contents, sessions };
  }, [groupId]);
  const { data, error, refresh } = useCampaignQuery(load, revision);
  const mutation = useCampaignMutation(refresh);
  const [session, setSession] = useState("");
  const [filter, setFilter] = useState("");
  const [historySession, setHistorySession] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [grid, setGrid] = useState(true);
  const [distribution, setDistribution] = useState([]);
  const request = useRef(null);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando tesoro…</p>;
  const { wallet, items, history, sessions } = data;

  function commit(movements) {
    return mutation.run(async () => {
      const fingerprint = JSON.stringify([movements, session]);
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      await treasury.move(movements, session, request.current.id);
      request.current = null;
      onMove();
    });
  }

  return <div className="chronicle-panel">
    <h4>Monedero</h4>
    <Wallet rows={wallet} />
    {!archived && <details>
      <summary>Ingresos, transferencias y reparto</summary>
      <SelectRow label="Sesión del movimiento" rows={sessions} value={session} onChange={setSession} empty="Sin sesión" />
      <MovementEditor groupId={groupId} items={items} characters={characters} busy={mutation.busy}
        onAdd={async (movement) => {
          if (movement.operation !== "distribution") return commit([movement]);
          setDistribution((previous) => [...previous, movement]);
          return true;
        }} />
      {distribution.length > 0 && <div>
        <ul>{distribution.map((row, index) => <li key={index}>{characters.find(({ id }) => id === row.character_id)?.name}
          {" · "}{row.quantity} {denominations[row.denomination]}
          <button type="button" disabled={mutation.busy} onClick={() => setDistribution(distribution.filter((_, i) => index !== i))}>Quitar</button>
        </li>)}</ul>
        <button type="button" disabled={mutation.busy} onClick={async () => {
          if (await commit(distribution)) setDistribution([]);
        }}>Confirmar reparto</button>
      </div>}
    </details>}
    {mutation.error && <p className="error" role="alert">{mutation.error}</p>}
    <div className="chronicle-actions">
      <label>Buscar objetos <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <SelectRow label="Categoría" rows={asRows(categories)} value={category} onChange={setCategory} empty="Todas" />
      <button type="button" aria-pressed={grid} onClick={() => setGrid(!grid)}>{grid ? "Ver listado" : "Ver cuadrícula"}</button>
    </div>
    <ul className={grid ? "treasure-grid" : "treasure-list"}>{items.filter((row) => (!category || row.category === category)
      && row.name.toLowerCase().includes(search.toLowerCase())).map((row) => (
      <li key={row.id}>
        <ItemArtwork key={row.artwork_path} path={row.artwork_path} name={row.name} />
        <div><strong>{row.name}</strong> × {row.quantity} · {categories[row.category]}
          <ItemDetails details={row.details} />
          {!archived && (director || row.contributed_by === userId) && <div className="chronicle-actions">
            <label>{row.artwork_path ? "Sustituir imagen" : "Añadir imagen"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                disabled={mutation.busy} onChange={(event) => {
                  const file = event.target.files[0];
                  event.target.value = "";
                  if (file) mutation.run(() => treasury.setArtwork(row, file));
                }} />
            </label>
            {row.artwork_path && <button type="button" disabled={mutation.busy}
              onClick={() => mutation.run(() => treasury.setArtwork(row, null))}>Quitar imagen</button>}
          </div>}
        </div>
      </li>
    ))}</ul>
    <details>
      <summary>Historial de movimientos</summary>
      <div className="chronicle-actions">
        <SelectRow label="Operación" rows={asRows(operations)} value={filter} onChange={setFilter} empty="Todas" />
        <SelectRow label="Sesión" rows={sessions} value={historySession} onChange={setHistorySession} empty="Todas" />
      </div>
      <ul className="chronicle-list">{history.slice().reverse().filter((row) =>
        (!filter || row.operation === filter) && (!historySession || row.session_id === historySession)).map((row) => (
        <li key={row.id}><time>{new Date(row.created_at).toLocaleString()}</time> · {row.author_name} · {operations[row.operation]}
          {" · "}{row.quantity} × {denominations[row.denomination] ?? row.item}
          {row.character_id && <> · {characters.find(({ id }) => id === row.character_id)?.name ?? `Personaje #${row.character_id}`}</>}
          {row.session_id && <> · {sessions.find(({ id }) => id === row.session_id)?.title}</>}
        </li>
      ))}</ul>
    </details>
  </div>;
}

export function PersonalWallet({ characterId }) {
  const load = useCallback(() => treasury.personal(characterId), [characterId]);
  const { data, error } = useCampaignQuery(load);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando monedero…</p>;
  return <Wallet rows={data[1]} />;
}
