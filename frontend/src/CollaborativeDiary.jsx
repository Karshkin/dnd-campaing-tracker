import { useEffect, useState } from "react";
import { CampaignComments, CommentAuthor } from "./CampaignComments";
import { SelectRow, useCampaignMutation } from "./ChronicleControls";

const visibilityOptions = [{ id: "shared", name: "Compartida" }, { id: "private", name: "Privada para mí y el director" }];

function DiaryEditor({ entry, authors, director, sessions, onSave, onCancel, busy }) {
  const [author, setAuthor] = useState(director ? null : authors[0]?.id);
  const [visibility, setVisibility] = useState(entry.visibility ?? "shared");
  const [session, setSession] = useState(entry.session_id ?? "");
  return <form className="form" onSubmit={(event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const draft = {
      title: values.get("title").trim(), content: values.get("content"), visibility,
      session_id: session || null,
      ...(entry.id ? {} : { author_character_id: author ?? null }),
    };
    onSave(draft);
  }}>
    {!entry.id && <CommentAuthor authors={authors} value={author} onChange={setAuthor} allowDirector={director} />}
    <label>Título <input name="title" maxLength={120} required defaultValue={entry.title} /></label>
    <label>Entrada <textarea name="content" rows={5} required defaultValue={entry.content} /></label>
    <SelectRow label="Visibilidad" rows={visibilityOptions} value={visibility} onChange={setVisibility} />
    <SelectRow label="Sesión" rows={sessions} value={session} onChange={setSession} empty="Sin sesión" />
    <div className="chronicle-actions">
      <button disabled={busy}>Guardar entrada</button>
      <button type="button" onClick={onCancel}>Cancelar</button>
    </div>
  </form>;
}

export function CollaborativeDiary({ entries, search, sessions, authors, director, userId, api, refresh }) {
  const [editing, setEditing] = useState(null);
  const mutation = useCampaignMutation(refresh);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 45_000);
    return () => clearInterval(timer);
  }, [refresh]);
  const filtered = entries.filter((row) => [row.title, row.content, row.author_character_name, row.author_account_name]
    .some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));

  async function send(path, method, body) {
    const response = await api(path, { method, body });
    if (!response.ok) throw new Error((await response.json()).detail);
  }

  return <div className="chronicle-flow">
    {(director || authors.length > 0) && <button type="button" onClick={() => setEditing({})}>Nueva entrada</button>}
    {!director && !authors.length && <p>Crea un personaje propio para firmar entradas.</p>}
    {mutation.error && <p role="alert">{mutation.error}</p>}
    {editing && <DiaryEditor key={editing.id ?? "new"} entry={editing} authors={authors} director={director}
      sessions={sessions} busy={mutation.busy} onCancel={() => setEditing(null)}
      onSave={async (draft) => {
        const saved = await mutation.run(() => editing.id ? send(`/diary/${editing.id}`, "PUT", draft)
          : send("/diary", "POST", draft));
        if (saved) setEditing(null);
      }} />}
    <ul className="chronicle-list">{filtered.map((row) => {
      const editable = director || row.author_user_id === userId;
      return <li key={row.id} id={`diary-entry-${row.id}`} className="chronicle-panel chronicle-reading">
        <h3>{row.title}</h3>
        <p>{[row.author_character_name, row.author_account_name].filter(Boolean).join(" · ") || "Entrada anterior"}
          {row.visibility === "private" && " · Privada"}
          {row.session_id && <> · {sessions.find(({ id }) => id === row.session_id)?.title}</>}
        </p>
        <p className="chronicle-pre">{row.content}</p>
        {row.image_path && <a href={row.image_path} target="_blank" rel="noreferrer">
          <img className="diary-entry-image" src={row.image_path} alt={row.title} />
        </a>}
        {editable && <div className="chronicle-actions">
          <button type="button" disabled={mutation.busy} onClick={() => setEditing(row)}>Editar entrada</button>
          <label>{row.image_path ? "Sustituir imagen" : "Añadir imagen"}
            <input type="file" accept="image/*" disabled={mutation.busy} onChange={(event) => {
              const file = event.target.files[0];
              event.target.value = "";
              if (!file) return;
              const form = new FormData();
              form.append("file", file);
              mutation.run(() => send(`/diary/${row.id}/image`, "POST", form));
            }} />
          </label>
          {row.image_path && <button type="button" disabled={mutation.busy}
            onClick={() => mutation.run(() => send(`/diary/${row.id}/image`, "DELETE"))}>Quitar imagen</button>}
          <button type="button" disabled={mutation.busy} onClick={() => {
            if (window.confirm(`¿Eliminar «${row.title}» y sus comentarios?`)) mutation.run(() => send(`/diary/${row.id}`, "DELETE"));
          }}>Eliminar entrada</button>
        </div>}
        <CampaignComments collection="diary" entryId={row.id} authors={authors} />
      </li>;
    })}</ul>
  </div>;
}
