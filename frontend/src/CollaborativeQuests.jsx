import { useState } from "react";
import { campaignChronicle } from "./campaign";
import { CommentAuthor } from "./CampaignComments";
import { Choices, SelectRow } from "./ChronicleControls";

const states = { active: "Activa", completed: "Completada", failed: "Fallida" };
const groups = { active: "Activas", completed: "Completadas", failed: "Fallidas" };
const priorities = { low: "Baja", normal: "Normal", high: "Alta" };
const visibilityLabels = { shared: "Grupal", private: "Personal" };
const labels = { participants: "Participantes", npc_ids: "PNJ", organization_ids: "Organizaciones", creature_ids: "Criaturas", place_ids: "Lugares" };
const toRows = (values) => Object.entries(values).map(([id, name]) => ({ id, name }));

function QuestEditor({ entry, authors, director, sessions, choices, mutation, onDone }) {
  const [author, setAuthor] = useState(director ? null : authors[0]?.id);
  const [visibility, setVisibility] = useState(entry.visibility ?? "shared");
  const [priority, setPriority] = useState(entry.priority ?? "normal");
  const [proposed, setProposed] = useState(entry.proposed_status ?? "active");
  const [official, setOfficial] = useState(entry.status ?? "active");
  const [session, setSession] = useState(entry.session_id ?? "");
  const [objectives, setObjectives] = useState((entry.objectives ?? []).map((objective) => ({ ...objective, key: crypto.randomUUID() })));
  const [links, setLinks] = useState(Object.fromEntries(Object.keys(labels).map((key) => [key, entry[key] ?? []])));

  function patchObjective(key, change) {
    setObjectives((current) => current.map((row) => row.key === key ? { ...row, ...change } : row));
  }

  return <form className="form" onSubmit={async (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const saved = await mutation.run(() => campaignChronicle.save("chronicle_quests", {
      ...fields, ...links, objectives: objectives.map(({ title, done }) => ({ title: title.trim(), done })),
      visibility, priority, proposed_status: proposed, session_id: session || null,
      ...(director ? { status: official } : {}),
      ...(entry.id ? {} : { author_character_id: author ?? null }),
    }, entry.id));
    if (saved) onDone();
  }}>
    {!entry.id && <CommentAuthor authors={authors} value={author} onChange={setAuthor} allowDirector={director} />}
    <label>Título <input name="title" maxLength={120} required defaultValue={entry.title} /></label>
    <label>Descripción <textarea name="description" defaultValue={entry.description} /></label>
    <div className="chronicle-actions">
      <SelectRow label="Tipo de misión" rows={toRows(visibilityLabels)} value={visibility} onChange={setVisibility} />
      <SelectRow label="Prioridad" rows={toRows(priorities)} value={priority} onChange={setPriority} />
      <SelectRow label="Estado propuesto" rows={toRows(states)} value={proposed} onChange={setProposed} />
      {director && <SelectRow label="Estado oficial" rows={toRows(states)} value={official} onChange={setOfficial} />}
      <SelectRow label="Sesión" rows={sessions} value={session} onChange={setSession} empty="Sin sesión" />
    </div>
    {director && <label>Recompensas <textarea name="rewards" defaultValue={entry.rewards} /></label>}
    <fieldset className="chronicle-choices">
      <legend>Objetivos</legend>
      {objectives.map(({ key, title, done }, index) => <div key={key} className="chronicle-actions">
        <label>Objetivo {index + 1}
          <input value={title} required maxLength={500} onChange={(event) => patchObjective(key, { title: event.target.value })} />
        </label>
        <label><input type="checkbox" checked={done} onChange={(event) => patchObjective(key, { done: event.target.checked })} /> Completado</label>
        <button type="button" onClick={() => setObjectives(objectives.filter((row) => row.key !== key))}>Quitar objetivo</button>
      </div>)}
      <button type="button" disabled={objectives.length >= 100}
        onClick={() => setObjectives([...objectives, { key: crypto.randomUUID(), title: "", done: false }])}>Añadir objetivo</button>
    </fieldset>
    <div className="chronicle-choice-grid">
      {Object.entries(labels).map(([key, label]) => <Choices key={key} label={label} rows={choices[key]} values={links[key]}
        onChange={(ids) => setLinks({ ...links, [key]: ids })} />)}
    </div>
    <div className="chronicle-actions">
      <button disabled={mutation.busy}>Guardar misión</button>
      <button type="button" onClick={onDone}>Cancelar</button>
    </div>
  </form>;
}

export function CollaborativeQuests({ data, director, authors, characters, entities, userId, mutation, sessionState }) {
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState(null);
  const choices = {
    participants: characters, npc_ids: entities.npc_id, organization_ids: entities.organization_id,
    creature_ids: entities.creature_id, place_ids: entities.place_id,
  };
  const visibleGroups = Object.entries(groups).filter(([id]) => !status || status === id);
  return <section className="chronicle-flow">
    <div className="chronicle-actions">
      <SelectRow label="Estado oficial" rows={toRows(states)} value={status} onChange={setStatus} empty="Todos" />
      {(director || authors.length > 0) && <button type="button" onClick={() => setEditing({})}>Nueva misión</button>}
    </div>
    {editing && <QuestEditor key={editing.id ?? "new"} entry={editing} authors={authors} director={director}
      choices={choices} sessions={data.sessions} mutation={mutation} onDone={() => setEditing(null)} />}
    <div className="quest-groups">{visibleGroups.map(([id, label]) => {
      const quests = data.quests.filter((row) => row.status === id);
      return <section key={id} className="quest-group" aria-labelledby={`quest-group-${id}`}>
        <h3 id={`quest-group-${id}`}>{label} <span>{quests.length}</span></h3>
        {quests.length === 0 && <p>No hay misiones en este estado.</p>}
        <ul className="chronicle-list">{quests.map((row) => {
          const editable = director || row.author_user_id === userId;
          return <li key={row.id} className="chronicle-panel">
            <h4>{row.title}</h4>
            <p>{[row.author_character_name, row.author_account_name].filter(Boolean).join(" · ") || "Misión anterior"}
              {" · "}{visibilityLabels[row.visibility]}{" · "}{priorities[row.priority]}</p>
            <p>Estado oficial: {states[row.status]} · Propuesta: {states[row.proposed_status]}</p>
            <p className="chronicle-pre">{row.description}</p>
            {row.rewards && <p>Recompensas: {row.rewards}</p>}
            {row.session_id && <button type="button" onClick={() => sessionState(row.session_id)}>
              {data.sessions.find(({ id }) => id === row.session_id)?.title ?? "Sesión vinculada"}</button>}
            {Object.entries(labels).map(([key, label]) => {
              const names = choices[key].filter(({ id }) => row[key].includes(id)).map((item) => item.name ?? item.title);
              return names.length ? <p key={key}>{label} · {names.join(", ")}</p> : null;
            })}
            {row.objectives.length > 0 && <ul className="chronicle-list">
              {row.objectives.map((objective, index) => <li key={index}>
                <label><input type="checkbox" checked={objective.done} disabled={!editable || mutation.busy}
                  onChange={(event) => {
                    const objectives = row.objectives.map((item, position) =>
                      position === index ? { ...item, done: event.target.checked } : item);
                    mutation.run(() => campaignChronicle.save("chronicle_quests", { objectives }, row.id));
                  }} /> {objective.title}</label>
              </li>)}
            </ul>}
            {editable && <button type="button" onClick={() => setEditing(row)}>Editar misión</button>}
          </li>;
        })}</ul>
      </section>;
    })}</div>
  </section>;
}
