import { useTranslation } from "react-i18next";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { campaignChronicle, groupInventory, treasury } from "./campaign";
import { Choices, SelectRow, useCampaignMutation, useCampaignQuery } from "./ChronicleControls";
import { denominations, MovementEditor } from "./Treasury";
import "./chronicle.css";

const states = { draft: "Borrador", published: "Publicada", closed: "Cerrada" };
const questStates = { active: "Activa", completed: "Completada", failed: "Fallida" };
const alignments = { allied: "Aliado", foe: "Enemigo", neutral: "Neutral" };
const linkTypes = { npc_id: "PNJ", organization_id: "Organizaciones", creature_id: "Criaturas", place_id: "Lugares" };
const rows = (labels) => Object.entries(labels).map(([id, name]) => ({ id, name }));
const sanitization = {
  ALLOWED_TAGS: ["div", "p", "br", "b", "strong", "i", "em", "ul", "ol", "li", "blockquote", "h3", "h4"],
  ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
};
const cleanSummary = (html) => DOMPurify.sanitize(html, sanitization);
const textSummary = (html) => new DOMParser().parseFromString(cleanSummary(html), "text/html").body.textContent;
const emptySession = { title: "", played_on: "", chapter_id: "", summary: "", rewards: "", decisions: "", consequences: "" };

function RichSummary({ initial, editor }) {
  useLayoutEffect(() => {
    editor.current.innerHTML = cleanSummary(initial);
  }, [editor, initial]);
  return <>
    <div className="chronicle-actions" role="group" aria-label="Formato del resumen">
      {[["bold", "Negrita"], ["italic", "Cursiva"], ["insertUnorderedList", "Lista"], ["insertOrderedList", "Lista numerada"]]
        .map(([command, label]) => <button type="button" key={command} onMouseDown={(event) => event.preventDefault()}
          onClick={() => { editor.current.focus(); document.execCommand(command); }}>{label}</button>)}
    </div>
    <div className="chronicle-editor" ref={editor} contentEditable role="textbox" aria-label="Resumen"
      aria-multiline="true" suppressContentEditableWarning onPaste={(event) => {
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
      }} onDrop={(event) => event.preventDefault()} />
  </>;
}

function SessionEditor({ session, data, entities, characters, onSave, busy, onCancel }) {
  const editor = useRef(null);
  const [attendance, setAttendance] = useState(data.attendance.filter((entry) => entry.session_id === session.id).map((entry) => entry.character_id));
  const [links, setLinks] = useState(Object.fromEntries(Object.keys(linkTypes).map((key) => [
    key, data.links.filter((entry) => entry.session_id === session.id && entry[key] != null).map((entry) => entry[key]),
  ])));
  const [chapter, setChapter] = useState(session.chapter_id ?? "");
  const notes = data.notes.find((entry) => entry.session_id === session.id)?.notes ?? "";

  return <form className="form chronicle-panel" onSubmit={(event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    onSave({
      ...fields, session_id: session.id ?? null, chapter_id: chapter || null,
      summary: cleanSummary(editor.current.innerHTML), attendance,
      links: Object.entries(links).flatMap(([key, ids]) => ids.map((id) => ({ [key]: id }))),
    });
  }}>
    <h3>{session.id ? "Editar sesión" : "Nueva sesión"}</h3>
    <label>Título <input name="title" maxLength={120} required defaultValue={session.title} /></label>
    <div className="chronicle-actions">
      <label>Fecha <input name="played_on" type="date" required defaultValue={session.played_on} /></label>
      <SelectRow label="Capítulo" rows={data.chapters} value={chapter} onChange={setChapter} empty="Sin capítulo" />
    </div>
    <RichSummary initial={session.summary} editor={editor} />
    <label>Recompensas <textarea name="rewards" defaultValue={session.rewards} /></label>
    <label>Decisiones <textarea name="decisions" defaultValue={session.decisions} /></label>
    <label>Consecuencias <textarea name="consequences" defaultValue={session.consequences} /></label>
    <div className="chronicle-actions">
      <Choices label="Asistencia" rows={characters} values={attendance} onChange={setAttendance} />
      {Object.entries(linkTypes).map(([key, label]) => <Choices key={key} label={label} rows={entities[key]}
        values={links[key]} onChange={(ids) => setLinks({ ...links, [key]: ids })} />)}
    </div>
    <label>Notas privadas del director <textarea name="notes" defaultValue={notes} /></label>
    <div className="chronicle-actions">
      <button disabled={busy}>Guardar sesión</button>
      <button type="button" onClick={onCancel}>Cancelar</button>
    </div>
  </form>;
}

function Closure({ session, data, entities, characters, mutation, onDone }) {
  const [group, setGroup] = useState("");
  const [organization, setOrganization] = useState("");
  const [quest, setQuest] = useState("");
  const [questState, setQuestState] = useState("completed");
  const [npc, setNpc] = useState("");
  const [alignment, setAlignment] = useState("neutral");
  const [reputation, setReputation] = useState([]);
  const [quests, setQuests] = useState([]);
  const [npcs, setNpcs] = useState([]);
  const [movements, setMovements] = useState([]);
  const load = useCallback(() => group ? treasury.contents(group) : null, [group]);
  const stock = useCampaignQuery(load);

  function addChange(event, add) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    add(fields);
    if (event.currentTarget.elements.delta) event.currentTarget.elements.delta.value = "";
    if (event.currentTarget.elements.reason) event.currentTarget.elements.reason.value = "";
  }

  const pending = [
    ...movements.map((row, index) => [
      `Reparto · ${row.quantity} ${denominations[row.denomination] ?? stock.data?.items.find(({ id }) => id === row.item_id)?.name ?? "objetos"} → ${characters.find(({ id }) => id === row.character_id)?.name}`,
      () => setMovements(movements.filter((_, i) => i !== index)),
    ]),
    ...reputation.map((entry, index) => [
      `Reputación · ${entities.organization_id.find(({ id }) => id === entry.organization_id)?.name} · ${entry.delta} · ${entry.reason}`,
      () => setReputation(reputation.filter((_, i) => i !== index)),
    ]),
    ...quests.map((entry, index) => [
      `Misión · ${data.quests.find(({ id }) => id === entry.id)?.title} · ${questStates[entry.status]}`,
      () => setQuests(quests.filter((_, i) => i !== index)),
    ]),
    ...npcs.map((entry, index) => [
      `PNJ · ${entities.npc_id.find(({ id }) => id === entry.id)?.name} · ${alignments[entry.alignment]}`,
      () => setNpcs(npcs.filter((_, i) => i !== index)),
    ]),
  ];

  return <div className="chronicle-panel">
    <h4>Cerrar sesión</h4>
    <SelectRow label="Grupo para botín y reputación" rows={data.groups} value={group} onChange={setGroup} empty="Selecciona un grupo" />
    {stock.error && <p role="alert">{stock.error}</p>}
    {group && stock.data && <details><summary>Distribuir botín</summary>
      <MovementEditor key={group} groupId={Number(group)} characters={characters} items={stock.data.items}
        busy={mutation.busy} closure onAdd={(movement) => { setMovements([...movements, movement]); return true; }} />
    </details>}
    {group && <details><summary>Cambiar reputación</summary>
      <form className="form" onSubmit={(event) => addChange(event, (fields) => {
        setReputation([...reputation, {
          organization_id: Number(organization), group_id: Number(group),
          delta: Number(fields.get("delta")), reason: fields.get("reason"),
        }]);
      })}>
        <SelectRow label="Organización" rows={entities.organization_id} value={organization} onChange={setOrganization} empty="Selecciona una organización" required />
        <label>Puntos <input type="number" name="delta" min="-2147483648" max="2147483647" required /></label>
        <label>Motivo <input name="reason" maxLength={2000} required /></label>
        <button disabled={mutation.busy}>Añadir ajuste</button>
      </form>
    </details>}
    <details><summary>Actualizar misión o PNJ</summary>
      <form className="form" onSubmit={(event) => addChange(event, () => setQuests([
        ...quests.filter((row) => row.id !== quest), { id: quest, status: questState },
      ]))}>
        <SelectRow label="Misión" rows={data.quests} value={quest} onChange={setQuest} empty="Selecciona una misión" required />
        <SelectRow label="Estado" rows={rows(questStates)} value={questState} onChange={setQuestState} />
        <button disabled={mutation.busy}>Añadir cambio de misión</button>
      </form>
      <form className="form" onSubmit={(event) => addChange(event, () => setNpcs([
        ...npcs.filter((row) => row.id !== Number(npc)), { id: Number(npc), alignment },
      ]))}>
        <SelectRow label="PNJ" rows={entities.npc_id} value={npc} onChange={setNpc} empty="Selecciona un PNJ" required />
        <SelectRow label="Alineamiento" rows={rows(alignments)} value={alignment} onChange={setAlignment} />
        <button disabled={mutation.busy}>Añadir cambio de PNJ</button>
      </form>
    </details>
    <ul className="chronicle-list">{pending.map(([label, remove], index) => (
      <li key={index}>{label} <button type="button" onClick={remove} disabled={mutation.busy}>Quitar</button></li>
    ))}</ul>
    <button disabled={mutation.busy} type="button" onClick={async () => {
      if (!window.confirm("¿Publicar el resumen y aplicar todos los cambios del cierre?")) return;
      if (await mutation.run(() => campaignChronicle.action("close", {
        session_id: session.id, movements, reputation, quests, npcs,
      }))) onDone();
    }}>Publicar y cerrar sesión</button>
  </div>;
}

function Gallery({ data, campaignId, director, mutation }) {
  const cover = data.images.find((image) => image.cover);
  return <>
    {cover?.url && <figure className="chronicle-cover"><img src={cover.url} alt={cover.caption} />
      {cover.caption && <figcaption>{cover.caption}</figcaption>}</figure>}
    <section className="chronicle-flow">
      {director && <form className="form" onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        if (await mutation.run(() => campaignChronicle.addImage(campaignId, fields.get("image"), fields.get("caption")))) form.reset();
      }}>
        <label>Imagen <input name="image" required type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" /></label>
        <label>Pie de foto <input name="caption" maxLength={200} /></label>
        <button disabled={mutation.busy}>Subir imagen</button>
      </form>}
      <div className="chronicle-gallery">
        {data.images.map((image) => <figure key={image.id}>
          {image.url && <a href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt={image.caption || "Imagen de la crónica"} /></a>}
          <figcaption>{image.caption}</figcaption>
          {director && <div className="chronicle-actions">
            {!image.cover && <button type="button" disabled={mutation.busy} onClick={() => mutation.run(() => campaignChronicle.action("cover", { id: image.id }))}>Usar en portada</button>}
            <button type="button" disabled={mutation.busy} onClick={() => {
              if (window.confirm("¿Eliminar esta imagen de la crónica?")) mutation.run(() => campaignChronicle.removeImage(image.id));
            }}>Eliminar</button>
          </div>}
        </figure>)}
      </div>
    </section>
  </>;
}

function Quests({ data, director, mutation, sessionState }) {
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState("active");
  const [session, setSession] = useState("");
  return <section className="chronicle-flow">
    <div className="chronicle-actions">
    <SelectRow label="Estado de misión" rows={rows(questStates)} value={filter} onChange={setFilter} empty="Todas" />
    {director && <button type="button" onClick={() => { setStatus("active"); setSession(""); setEditing({}); }}>Nueva misión</button>}
    </div>
    {editing && <form key={editing.id ?? "new"} className="form" onSubmit={async (event) => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      if (await mutation.run(() => campaignChronicle.save("chronicle_quests", {
        ...fields, status, session_id: session || null,
      }, editing.id))) setEditing(null);
    }}>
      <label>Título <input name="title" maxLength={120} defaultValue={editing.title} required /></label>
      <label>Descripción <textarea name="description" defaultValue={editing.description} /></label>
      <SelectRow label="Estado" rows={rows(questStates)} value={status} onChange={setStatus} />
      <SelectRow label="Sesión" rows={data.sessions} value={session} onChange={setSession} empty="Sin sesión" />
      <div className="chronicle-actions">
        <button disabled={mutation.busy}>Guardar misión</button>
        <button type="button" onClick={() => setEditing(null)}>Cancelar</button>
      </div>
    </form>}
    <ul className="chronicle-list">{data.quests.filter((row) => !filter || row.status === filter).map((row) => (
      <li key={row.id}><strong>{row.title}</strong> · {questStates[row.status]} · {row.description}
        {row.session_id && <> · <a href={`#session-${row.session_id}`} onClick={(event) => {
          event.preventDefault();
          sessionState(row.session_id);
        }}>{data.sessions.find(({ id }) => id === row.session_id)?.title}</a></>}
        {director && <button type="button" onClick={() => {
          setEditing(row); setStatus(row.status); setSession(row.session_id ?? "");
        }}>Editar misión</button>}
      </li>
    ))}</ul>
  </section>;
}

export function Chronicle({ campaignId, director, characters, organizations, allies, creatures, openEntity,
  onClose, legacy }) {
  const { t } = useTranslation();
  const [section, setSection] = useState("sessions");
  const load = useCallback(async () => {
    const [chapters, sessions, attendance, links, quests, images, notes, groups, places] = await Promise.all([
      campaignChronicle.list("chronicle_chapters", "position"), campaignChronicle.list("chronicle_sessions", "played_on"),
      campaignChronicle.attendance(), campaignChronicle.list("chronicle_links", "id"),
      campaignChronicle.list("chronicle_quests", "title"), campaignChronicle.images(),
      director ? campaignChronicle.notes() : [], director ? groupInventory.groups() : { groups: [] },
      campaignChronicle.list("points_of_interest", "title"),
    ]);
    return { chapters, sessions, attendance, links, quests, images, notes, groups: groups.groups, places };
  }, [director]);
  const { data, error, refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  const [search, setSearch] = useState("");
  const [chapter, setChapter] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState(null);
  const [closing, setClosing] = useState(null);
  const [chapterEdit, setChapterEdit] = useState(null);
  const [current, setCurrent] = useState(null);
  if (error) return <article className="card"><p role="alert">{error}</p><button type="button" onClick={refresh}>Reintentar</button></article>;
  if (!data) return <article className="card"><p role="status">Cargando crónica…</p></article>;
  const entities = { npc_id: allies, organization_id: organizations, creature_id: creatures, place_id: data.places };
  const sessions = data.sessions.slice().reverse().filter((row) => (!chapter || row.chapter_id === chapter)
    && (!status || row.status === status) && [row.title, textSummary(row.summary), row.rewards, row.decisions, row.consequences]
      .some((text) => text.toLowerCase().includes(search.trim().toLowerCase())));
  const session = sessions.find(({ id }) => id === current) ?? sessions[0];

  return <article className="card chronicle">
    <h2>{t("nav.chronicle")}</h2>
    <nav className="section-nav" aria-label={t("nav.chronicle")}>
      {["sessions", "quests", "gallery", "archive"].map((view) => (
        <button key={view} type="button" aria-pressed={section === view}
          className={section === view ? "active" : ""}
          onClick={() => { setSection(view); setSearch(""); }}>
          {t(`chronicleNav.${view}`)}
        </button>
      ))}
    </nav>
    {mutation.error && <p className="error" role="alert">{mutation.error}</p>}
    {section === "gallery" && <Gallery data={data} campaignId={campaignId} director={director} mutation={mutation} />}
    {section === "quests" && <Quests data={data} director={director} mutation={mutation} sessionState={(id) => {
      setSection("sessions"); setCurrent(id); setChapter(""); setStatus(""); setSearch("");
    }} />}
    {section === "archive" && <section className="chronicle-flow">
      <label>{t("chronicleNav.searchArchive")} <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {legacy(search)}
    </section>}
    {section === "sessions" && <section className="chronicle-flow">
      {director && <details><summary>Gestionar capítulos</summary>
        <ul className="chronicle-list">{data.chapters.map((row) => <li key={row.id}>{row.title}
          <button type="button" onClick={() => setChapterEdit(row)}>Editar capítulo</button></li>)}</ul>
        <form className="form" key={chapterEdit?.id ?? "new"} onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const fields = new FormData(form);
          if (await mutation.run(() => campaignChronicle.save("chronicle_chapters", {
            title: fields.get("title"), position: Number(fields.get("position")),
          }, chapterEdit?.id))) { form.reset(); setChapterEdit(null); }
        }}>
          <label>Título del capítulo <input name="title" required maxLength={120} defaultValue={chapterEdit?.title} /></label>
          <label>Orden <input type="number" name="position" defaultValue={chapterEdit?.position ?? 0} /></label>
          <button disabled={mutation.busy}>{chapterEdit ? "Guardar capítulo" : "Añadir capítulo"}</button>
          {chapterEdit && <button type="button" onClick={() => setChapterEdit(null)}>Cancelar</button>}
        </form>
      </details>}
      <div className="chronicle-actions">
        <label>Buscar en la crónica <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <SelectRow label="Capítulo" rows={data.chapters} value={chapter} onChange={setChapter} empty="Todos" />
        <SelectRow label="Estado de sesión" rows={rows(states).filter(({ id }) => director || id !== "draft")}
          value={status} onChange={setStatus} empty="Todos" />
        {director && <button type="button" onClick={() => { setEditing(emptySession); setClosing(null); }}>Nueva sesión</button>}
      </div>
      {editing && <SessionEditor key={editing.id ?? "new"} session={editing} data={data} entities={entities}
        characters={characters} busy={mutation.busy} onCancel={() => setEditing(null)} onSave={async (payload) => {
          if (await mutation.run(() => campaignChronicle.action("save_session", payload))) setEditing(null);
        }} />}
      {session ? <>
        <SelectRow label="Sesión" rows={sessions.map((row) => ({ ...row, title: `${row.played_on} · ${row.title}` }))}
          value={session.id} onChange={(id) => { setCurrent(id); setClosing(null); }} />
        <section className="chronicle-panel" id={`session-${session.id}`}>
          <h3>{session.title}</h3>
          <p><time dateTime={session.played_on}>{new Date(`${session.played_on}T00:00:00`).toLocaleDateString()}</time> · {states[session.status]}
            {session.chapter_id && <> · {data.chapters.find(({ id }) => id === session.chapter_id)?.title}</>}
          </p>
          <div dangerouslySetInnerHTML={{ __html: cleanSummary(session.summary) }} />
          <dl>{Object.entries({ rewards: "Recompensas", decisions: "Decisiones", consequences: "Consecuencias" })
            .filter(([field]) => session[field]).map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{session[field]}</dd></div>)}</dl>
          {data.attendance.some(({ session_id }) => session_id === session.id) && <p>Asistencia · {data.attendance
            .filter(({ session_id }) => session_id === session.id)
            .map(({ character_id }) => characters.find(({ id }) => id === character_id)?.name).filter(Boolean).join(", ")}</p>}
          <ul className="chronicle-list">{data.links.filter(({ session_id }) => session_id === session.id).map((row) => {
            const field = Object.keys(linkTypes).find((key) => row[key] != null);
            const entry = entities[field].find(({ id }) => id === row[field]);
            if (!entry) return null;
            return <li key={row.id}>{linkTypes[field]} · <button type="button" onClick={() => openEntity(field, entry)}>{entry.title ?? entry.name}</button></li>;
          })}</ul>
          {director && <>
            <details><summary>Notas privadas del director</summary>
              <p className="chronicle-pre">{data.notes.find(({ session_id }) => session_id === session.id)?.notes}</p>
            </details>
            <div className="chronicle-actions">
              <button type="button" onClick={() => { setEditing(session); setClosing(null); }}>Editar sesión</button>
              {session.status === "draft" && <button type="button" disabled={mutation.busy}
                onClick={() => mutation.run(() => campaignChronicle.action("publish", { session_id: session.id }))}>Publicar resumen</button>}
              {session.status !== "closed" && <button type="button" onClick={() => { setClosing(closing === session.id ? null : session.id); setEditing(null); }}>
                {closing === session.id ? "Cancelar cierre" : "Preparar cierre"}</button>}
            </div>
          </>}
          {closing === session.id && session.status !== "closed" && <Closure key={session.id} session={session}
            data={data} entities={entities} characters={characters} mutation={mutation} onDone={() => { setClosing(null); onClose(); }} />}
        </section>
      </> : <p>No hay sesiones que coincidan con los filtros.</p>}
    </section>}
  </article>;
}
