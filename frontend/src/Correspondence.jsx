import { useCallback, useState } from "react";
import { campaignChronicle, groupInventory, supabase } from "./campaign";
import { CommentAuthor } from "./CampaignComments";
import { Choices, SelectRow, useCampaignMutation, useCampaignQuery } from "./ChronicleControls";
import { VisibilityEditor } from "./VisibilityEditor";

const types = { letter: "Carta", contract: "Contrato", document: "Documento", message: "Mensaje" };
const typeOptions = Object.entries(types).map(([id, name]) => ({ id, name }));
const bucket = () => supabase.storage.from("campaign-documents");

async function value(result) {
  const { data, error } = await result;
  if (error) throw error;
  return data;
}

function Composer({ entry, authors, director, characters, groups, sessions, busy, save, cancel }) {
  const [author, setAuthor] = useState(director ? null : authors[0]?.id);
  const [type, setType] = useState(entry.kind ?? "letter");
  const [recipients, setRecipients] = useState(entry.recipients ?? []);
  const [targets, setTargets] = useState(entry.groups ?? []);
  const [session, setSession] = useState(entry.session_id ?? "");
  return <form className="form" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    save({
      kind: type, title: fields.get("title"), body: fields.get("body"), shared: fields.has("shared"),
      session_id: session || null, recipients, groups: targets,
      ...(entry.id ? {} : { author_character_id: author ?? null }),
    });
  }}>
    {!entry.id && <CommentAuthor authors={authors} value={author} onChange={setAuthor} allowDirector={director} />}
    <SelectRow label="Tipo" rows={typeOptions} value={type} onChange={setType} />
    <label>Asunto <input name="title" required maxLength={120} defaultValue={entry.title} /></label>
    <label>Contenido <textarea name="body" rows={5} maxLength={50000} required defaultValue={entry.body} /></label>
    <label><input type="checkbox" name="shared" defaultChecked={entry.shared} /> Visible para toda la campaña</label>
    <div className="chronicle-choice-grid">
      <Choices label="Personajes destinatarios" rows={characters} values={recipients} onChange={setRecipients} />
      <Choices label="Grupos destinatarios" rows={groups} values={targets} onChange={setTargets} />
    </div>
    <SelectRow label="Sesión vinculada" rows={sessions} value={session} onChange={setSession} empty="Sin sesión" />
    <div className="chronicle-actions"><button disabled={busy}>Guardar documento</button>
      <button type="button" onClick={cancel}>Cancelar</button></div>
  </form>;
}

function Attachments({ entry, editable }) {
  const load = useCallback(async () => {
    const rows = await value(supabase.from("document_images").select("id,path").eq("document_id", entry.id).order("id"));
    if (!rows.length) return [];
    const urls = await value(bucket().createSignedUrls(rows.map(({ path }) => path), 60));
    return rows.map((row, index) => ({ ...row, url: urls[index]?.signedUrl }));
  }, [entry.id]);
  const { data, error, refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  async function upload(file) {
    const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
    if (!extensions[file.type] || !file.size || file.size > 10485760) throw new Error("Usa una imagen compatible de hasta 10 MB");
    const path = `${entry.campaign_id}/${entry.id}/${crypto.randomUUID()}.${extensions[file.type]}`;
    await value(bucket().upload(path,file));
    try {
      await value(supabase.from("document_images").insert({ document_id: entry.id, path }));
    } catch (error) {
      await bucket().remove([path]);
      throw error;
    }
  }
  return <div>
    {editable && <label>Añadir adjunto
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={mutation.busy} onChange={(event) => {
        const file = event.target.files[0];
        event.target.value = "";
        if (file) mutation.run(() => upload(file));
      }} /></label>}
    {(error || mutation.error) && <p role="alert">{error || mutation.error}</p>}
    <div className="chronicle-gallery">{data?.map(({ id, url, path }, index) => <figure key={id}>
      {url && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Adjunto ${index + 1} de ${entry.title}`} /></a>}
      {editable && <button type="button" disabled={mutation.busy} onClick={() => mutation.run(async () => {
        await value(bucket().remove([path]));
        await value(supabase.from("document_images").delete().eq("id",id));
      })}>Quitar adjunto</button>}
    </figure>)}</div>
  </div>;
}

const linkTypes = {
  npc_id: ["PNJ", "allies", "name"], organization_id: ["Organización", "organizations", "name"],
  creature_id: ["Criatura", "creatures", "name"], place_id: ["Localización", "points_of_interest", "title"],
  quest_id: ["Misión", "chronicle_quests", "title"],
};
const linkOptions = Object.entries(linkTypes).map(([id,[name]]) => ({ id,name }));

function DocumentLinks({ document, editable }) {
  const [kind,setKind] = useState("npc_id");
  const [target,setTarget] = useState("");
  const load = useCallback(async () => {
    const values = Object.entries(linkTypes);
    const [links,...lookups] = await Promise.all([
      campaignChronicle.list("document_links","id",{ document_id: document.id }),
      ...values.map(([, [,table,field]]) => campaignChronicle.list(table,field)),
    ]);
    return { links, targets: Object.fromEntries(values.map(([key],index) => [key,lookups[index]])) };
  },[document.id]);
  const { data,error,refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  return <section className="chronicle-flow">
    <h4>Vínculos de campaña</h4>
    {(error || mutation.error) && <p role="alert">{error || mutation.error}</p>}
    {data?.links.length > 0 && <ul className="chronicle-list">{data.links.map((link) => {
      const field = Object.keys(linkTypes).find((key) => link[key] !== null);
      const entity = data.targets[field]?.find(({ id }) => id === link[field]);
      return <li key={link.id} className="row">
        {linkTypes[field][0]} · {entity?.title ?? entity?.name ?? ""}
        {editable && <button type="button" disabled={mutation.busy} onClick={() => mutation.run(() =>
          value(supabase.from("document_links").delete().eq("id",link.id)))}>Quitar vínculo</button>}
      </li>;
    })}</ul>}
    {editable && data && <form className="chronicle-actions" onSubmit={async (event) => {
      event.preventDefault();
      if (await mutation.run(() => campaignChronicle.save("document_links",{
        document_id: document.id, [kind]: kind === "quest_id" ? target : Number(target),
      }))) setTarget("");
    }}>
      <SelectRow label="Tipo de vínculo" rows={linkOptions} value={kind}
        onChange={(key) => { setKind(key); setTarget(""); }} />
      <SelectRow label="Entidad vinculada" rows={data.targets[kind]} value={target} onChange={setTarget}
        empty="Seleccionar entidad" required />
      <button disabled={!target || mutation.busy}>Vincular</button>
    </form>}
  </section>;
}

export function Correspondence({ director, authors, characters, userId }) {
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const load = useCallback(async () => {
    const [documents, receipts, sessions, inventory] = await Promise.all([
      campaignChronicle.list("campaign_documents", "created_at"),
      value(supabase.from("document_reads").select("document_id")),
      campaignChronicle.list("chronicle_sessions", "played_on"), groupInventory.groups(),
    ]);
    return { documents, receipts: new Set(receipts.map(({ document_id }) => document_id)), sessions, groups: inventory.groups };
  }, []);
  const { data, error, refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando correspondencia…</p>;
  const current = data.documents.find(({ id }) => id === selected);
  const editable = current && (director || current.author_user_id === userId);
  const filtered = data.documents.filter(({ id }) => !unreadOnly || !data.receipts.has(id)).slice().reverse();
  return <section className="card chronicle-flow"><h2>Correspondencia</h2>
    <div className="chronicle-actions">
      {(director || authors.length > 0) && <button type="button" onClick={() => setEditing({})}>Redactar documento</button>}
      <label><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} /> Solo sin leer</label>
    </div>
    {mutation.error && <p role="alert">{mutation.error}</p>}
    {editing && <Composer key={editing.id ?? "new"} entry={editing} authors={authors} director={director} characters={characters}
      groups={data.groups} sessions={data.sessions} busy={mutation.busy} cancel={() => setEditing(null)}
      save={async (draft) => {
        if (await mutation.run(async () => {
          const row = await campaignChronicle.save("campaign_documents", draft, editing.id);
          setSelected(row.id);
        })) setEditing(null);
      }} />}
    <ul className="chronicle-list">{filtered.map((row) => <li key={row.id}>
      <button type="button" aria-pressed={row.id === selected} onClick={() => setSelected(row.id)}>{row.title}</button>
      {" · "}{types[row.kind]}{!data.receipts.has(row.id) && " · Sin leer"}
    </li>)}</ul>
    {!filtered.length && <p>No hay documentos visibles en la bandeja.</p>}
    {current && <article className="chronicle-panel">
      <h3>{current.title}</h3>
      <p>{[current.author_character_name,current.author_account_name].filter(Boolean).join(" · ")}
        {" · "}{new Date(current.created_at).toLocaleDateString()}{!current.shared && " · Entrega privada"}</p>
      <p className="chronicle-pre">{current.body}</p>
      <div className="chronicle-actions">
        <button type="button" disabled={mutation.busy} onClick={() => mutation.run(() => value(data.receipts.has(current.id)
          ? supabase.from("document_reads").delete().eq("document_id",current.id)
          : supabase.from("document_reads").upsert({ document_id: current.id }, { onConflict: "document_id,user_id", ignoreDuplicates: true })))}>
          {data.receipts.has(current.id) ? "Marcar sin leer" : "Marcar como leído"}
        </button>
        {editable && <button type="button" onClick={() => setEditing(current)}>Editar documento</button>}
      </div>
      <VisibilityEditor kind="campaign_documents" id={current.id} characters={director ? characters : null} />
      <DocumentLinks key={`links:${current.id}`} document={current} editable={editable} />
      <Attachments key={current.id} entry={current} editable={editable} />
    </article>}
  </section>;
}
