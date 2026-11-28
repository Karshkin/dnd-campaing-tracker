import { useCallback, useState } from "react";
import { campaignChronicle, supabase } from "./campaign";
import { CommentAuthor } from "./CampaignComments";
import { SelectRow, useCampaignMutation, useCampaignQuery } from "./ChronicleControls";
import { VisibilityEditor } from "./VisibilityEditor";
import "./investigation.css";

const statuses = { unverified: "Sin verificar", confirmed: "Confirmado", refuted: "Desmentido" };
const kinds = { clue: "Pista", npc: "PNJ", organization: "Organización", place: "Localización",
  document: "Documento", rumor: "Rumor", quest: "Misión", event: "Acontecimiento" };
const entityTables = { npc: ["allies","name"], organization: ["organizations","name"], place: ["points_of_interest","title"],
  document: ["campaign_documents","title"], quest: ["chronicle_quests","title"], event: ["map_events","title"] };

async function remove(table,id) {
  const { error } = await supabase.from(table).delete().eq("id",id);
  if (error) throw error;
}

function RumorForm({ draft, authors, places, director, busy, save, close }) {
  const [author,setAuthor] = useState(director ? null : authors[0]?.id);
  return <form className="form" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    save({
      title: fields.get("title"), body: fields.get("body"), origin: fields.get("origin"), heard_on: fields.get("heard_on"),
      place_id: Number(fields.get("place_id")) || null, shared: fields.has("shared"),
      ...(!draft.id ? { author_character_id: author } : {}),
    });
  }}>
    {!draft.id && <CommentAuthor authors={authors} value={author} onChange={setAuthor} allowDirector={director} />}
    <label>Título <input name="title" required maxLength={120} defaultValue={draft.title} /></label>
    <label>Contenido <textarea name="body" required maxLength={10000} defaultValue={draft.body} /></label>
    <label>Origen <input name="origin" maxLength={120} defaultValue={draft.origin} /></label>
    <label>Fecha <input name="heard_on" type="date" required defaultValue={draft.heard_on ?? new Date().toLocaleDateString("en-CA")} /></label>
    <label>Localización <select name="place_id" defaultValue={draft.place_id ?? ""}>
      <option value="">Sin localización</option>
      {places.map(({ id,title }) => <option key={id} value={id}>{title}</option>)}
    </select></label>
    <label><input type="checkbox" name="shared" defaultChecked={draft.shared ?? true} /> Compartir con la campaña</label>
    <div className="row"><button disabled={busy}>Guardar rumor</button><button type="button" onClick={close}>Cancelar</button></div>
  </form>;
}

function NodeForm({ draft, entities, busy, save, close }) {
  const [kind,setKind] = useState(draft.kind ?? "clue");
  const [target,setTarget] = useState(draft.entity_id ?? "");
  return <form className="form" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    save({
      title: kind === "clue" ? fields.get("title") : "", notes: fields.get("notes"), shared: fields.has("shared"),
      x: Number(fields.get("x")), y: Number(fields.get("y")),
      ...(!draft.id ? { kind, entity_id: kind === "clue" ? null : target } : {}),
    });
  }}>
    {!draft.id && <SelectRow label="Tipo" rows={Object.entries(kinds).map(([id,name]) => ({ id,name }))}
      value={kind} onChange={(value) => { setKind(value); setTarget(""); }} />}
    {kind === "clue" ? <label>Título de la pista <input name="title" required maxLength={120} defaultValue={draft.title} /></label>
      : !draft.id && <SelectRow label="Entidad" rows={entities[kind] ?? []} value={target} onChange={setTarget}
        empty="Selecciona una entidad" required />}
    <label>Notas <textarea name="notes" maxLength={10000} defaultValue={draft.notes} /></label>
    <div className="row">{[["x","Posición horizontal"],["y","Posición vertical"]].map(([key,label]) => <label key={key}>
      {label} <input name={key} type="number" min={8} max={92} defaultValue={draft[key] ?? 50} required />
    </label>)}</div>
    <label><input type="checkbox" name="shared" defaultChecked={draft.shared ?? true} /> Compartir en el tablero</label>
    <div className="row"><button disabled={busy}>Guardar elemento</button><button type="button" onClick={close}>Cancelar</button></div>
  </form>;
}

function EdgeForm({ nodes, selected, title, busy, save }) {
  return <form className="chronicle-actions" onSubmit={(event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    save({ source: selected.id, target: fields.get("target"), label: fields.get("label"), shared: fields.has("shared") });
  }}>
    <label>Conectar con <select name="target" required defaultValue="">
      <option value="">Seleccionar elemento</option>
      {nodes.filter(({ id }) => id !== selected.id).map((node) => <option key={node.id} value={node.id}>{title(node)}</option>)}
    </select></label>
    <label>Relación <input name="label" maxLength={140} /></label>
    <label><input type="checkbox" name="shared" defaultChecked /> Compartir conexión</label>
    <button disabled={busy}>Crear conexión</button>
  </form>;
}

function Board({ data, userId, director, mutation }) {
  const [selected,setSelected] = useState(null);
  const [draft,setDraft] = useState(null);
  const [deleting,setDeleting] = useState(false);
  const byId = new Map(data.nodes.map((node) => [node.id,node]));
  const current = byId.get(selected);
  const title = (node) => node.kind === "clue" ? node.title
    : data.entities[node.kind]?.find(({ id }) => String(id) === node.entity_id)?.title ?? kinds[node.kind];
  const edges = data.edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target));
  return <section className="chronicle-flow">
    <div className="row"><h3>Tablero de investigación</h3>
      <button type="button" onClick={() => setDraft({ x: 20 + (data.nodes.length % 4) * 20, y: 20 + (Math.floor(data.nodes.length/4) % 4) * 20 })}>
        Añadir elemento
      </button>
    </div>
    {draft && <NodeForm key={draft.id ?? "new"} draft={draft} entities={data.entities} busy={mutation.busy}
      close={() => setDraft(null)} save={async (fields) => {
        if (await mutation.run(async () => {
          const node = await campaignChronicle.save("investigation_nodes",fields,draft.id);
          setSelected(node.id);
        })) setDraft(null);
      }} />}
    {data.nodes.length === 0 ? <p>El tablero aún no tiene elementos.</p> : <>
      <div className="investigation-board">
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          {edges.map(({ id,source,target }) => <line key={id}
            x1={byId.get(source).x} y1={byId.get(source).y} x2={byId.get(target).x} y2={byId.get(target).y} />)}
        </svg>
        {data.nodes.map((node) => <button className="investigation-node" key={node.id} type="button"
          aria-pressed={node.id === selected} style={{ left: `${node.x}%`, top: `${node.y}%` }}
          onClick={() => { setSelected(node.id); setDeleting(false); }} title={title(node)}>
          {title(node)}
        </button>)}
      </div>
      <label>Elemento del tablero <select value={selected ?? ""} onChange={(event) => { setSelected(event.target.value); setDeleting(false); }}>
        <option value="">Seleccionar elemento</option>
        {data.nodes.map((node) => <option key={node.id} value={node.id}>{title(node)}</option>)}
      </select></label>
    </>}
    {current && <section className="chronicle-panel chronicle-flow">
      <h4>{title(current)}</h4>
      {current.notes && <p className="chronicle-pre">{current.notes}</p>}
      {(director || current.owner === userId) && <div className="row">
        <button type="button" onClick={() => setDraft(current)}>Editar notas o posición</button>
        {deleting ? <>
          <button type="button" disabled={mutation.busy} onClick={async () => {
            if (await mutation.run(() => remove("investigation_nodes",current.id))) { setSelected(null); setDeleting(false); }
          }}>Confirmar retirada y conexiones</button>
          <button type="button" onClick={() => setDeleting(false)}>Cancelar</button>
        </> : <button type="button" onClick={() => setDeleting(true)}>Retirar elemento</button>}
      </div>}
      {data.nodes.length > 1 && <EdgeForm key={current.id} nodes={data.nodes} selected={current} title={title}
        busy={mutation.busy} save={(fields) => mutation.run(() => campaignChronicle.save("investigation_edges",fields))} />}
      <ul className="chronicle-list">{edges.filter(({ source,target }) => source === selected || target === selected).map((edge) => <li key={edge.id}>
        {title(byId.get(edge.source))} ↔ {title(byId.get(edge.target))}{edge.label && ` · ${edge.label}`}
        {(director || edge.owner === userId) && <button type="button" disabled={mutation.busy}
          onClick={() => mutation.run(() => remove("investigation_edges",edge.id))}>Retirar conexión</button>}
      </li>)}</ul>
    </section>}
  </section>;
}

export function Investigation({ director, authors, characters, userId }) {
  const [tab,setTab] = useState("rumors");
  const [draft,setDraft] = useState(null);
  const [status,setStatus] = useState("");
  const load = useCallback(async () => {
    const [rumors,nodes,edges,...sources] = await Promise.all([
      campaignChronicle.list("campaign_rumors","heard_on"),
      campaignChronicle.list("investigation_nodes","id"),
      campaignChronicle.list("investigation_edges","id"),
      ...Object.values(entityTables).map(([table,sort]) => campaignChronicle.list(table,sort)),
    ]);
    const entities = Object.fromEntries(Object.keys(entityTables).map((kind,index) => [kind,
      sources[index].map(({ id,name,title }) => ({ id,title: title ?? name }))]));
    return { rumors,nodes,edges,entities: { ...entities,rumor: rumors } };
  },[]);
  const { data,error,refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando investigación…</p>;
  return <section className="chronicle-flow">
    <h2>Rumores e investigación</h2>
    <div className="row">
      <button type="button" aria-pressed={tab === "rumors"} onClick={() => setTab("rumors")}>Rumores</button>
      <button type="button" aria-pressed={tab === "board"} onClick={() => setTab("board")}>Tablero</button>
    </div>
    {mutation.error && <p role="alert">{mutation.error}</p>}
    {tab === "board" ? <Board data={data} userId={userId} director={director} mutation={mutation} /> : <>
      <div className="chronicle-actions">
        <SelectRow label="Estado" rows={Object.entries(statuses).map(([id,name]) => ({ id,name }))} value={status} onChange={setStatus} empty="Todos" />
        {(director || authors.length > 0) && <button type="button" onClick={() => setDraft({})}>Anotar rumor</button>}
      </div>
      {draft && <RumorForm key={draft.id ?? "new"} draft={draft} director={director} authors={authors} places={data.entities.place}
        busy={mutation.busy} close={() => setDraft(null)} save={async (fields) => {
          if (await mutation.run(() => campaignChronicle.save("campaign_rumors",fields,draft.id))) setDraft(null);
        }} />}
      <ul className="chronicle-list">{data.rumors.filter((row) => !status || row.status === status).map((row) => <li className="chronicle-panel" key={row.id}>
        <h3>{row.title}</h3>
        <p>{[statuses[row.status],row.heard_on,row.author_character_name ?? row.author_account_name,row.origin,
          data.entities.place.find(({ id }) => id === row.place_id)?.title].filter(Boolean).join(" · ")}</p>
        <p className="chronicle-pre">{row.body}</p>
        {(director || row.author_user_id === userId) && <button type="button" onClick={() => setDraft(row)}>Editar rumor</button>}
        {director && <>
          <SelectRow label="Validación" rows={Object.entries(statuses).map(([id,name]) => ({ id,name }))} value={row.status}
            onChange={(value) => mutation.run(() => campaignChronicle.save("campaign_rumors",{ status: value },row.id))} />
          <VisibilityEditor kind="campaign_rumors" id={row.id} characters={characters} />
        </>}
      </li>)}</ul>
    </>}
  </section>;
}
