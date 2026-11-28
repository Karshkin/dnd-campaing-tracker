import { useCallback, useState } from "react";
import { campaignChronicle, campaignVisibility, supabase } from "./campaign";
import { Choices, SelectRow, useCampaignMutation, useCampaignQuery } from "./ChronicleControls";

const audiences = [
  { id: "discovered", name: "Descubierto por la campaña" },
  { id: "hidden", name: "Oculto · Solo el director" },
  { id: "individual", name: "Revelación individual" },
];

function VisibilityForm({ kind, id, characters }) {
  const load = useCallback(() => campaignVisibility.get(kind, id), [kind, id]);
  const { data, error, refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  const [mode, setMode] = useState(null);
  const [selection, setSelection] = useState(null);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando visibilidad…</p>;
  const visibility = mode ?? data.visibility;
  const recipients = selection ?? data.recipients;
  return <form className="form" onSubmit={(event) => {
    event.preventDefault();
    mutation.run(() => campaignVisibility.save(kind, id, visibility, recipients));
  }}>
    <SelectRow label="Quién puede verla" rows={audiences} value={visibility} onChange={setMode} />
    {visibility === "individual" && <fieldset className="chronicle-choices">
      <legend>Personajes autorizados</legend>
      <div className="choice-options">{characters.map(({ id, name }) => <label key={id}>
        <input type="checkbox" checked={recipients.includes(id)}
          onChange={(event) => setSelection(event.target.checked ? [...recipients, id] : recipients.filter((other) => other !== id))} />
        {name}
      </label>)}</div>
    </fieldset>}
    {mutation.error && <p role="alert">{mutation.error}</p>}
    <button disabled={mutation.busy || (visibility === "individual" && !recipients.length)}>Guardar visibilidad</button>
  </form>;
}

const secretAudiences = [
  { id: "director", name: "Solo dirección" },
  { id: "campaign", name: "Toda la campaña" },
  { id: "characters", name: "Personajes seleccionados" },
];

function SecretEditor({ draft, characters, busy, save, cancel }) {
  const [audience,setAudience] = useState(draft.audience ?? "director");
  const [recipients,setRecipients] = useState(draft.recipients ?? []);
  return <form className="form" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    save({ label: fields.get("label"), content: fields.get("content"), audience,
      recipients: audience === "characters" ? recipients : [] });
  }}>
    <label>Título <input name="label" required maxLength={120} defaultValue={draft.label} /></label>
    <label>Información <textarea name="content" required maxLength={20000} defaultValue={draft.content} /></label>
    <SelectRow label="Revelar a" rows={secretAudiences} value={audience} onChange={setAudience} />
    {audience === "characters" && <Choices label="Personajes autorizados" rows={characters}
      values={recipients} onChange={setRecipients} />}
    <div className="row">
      <button disabled={busy || (audience === "characters" && !recipients.length)}>Guardar información</button>
      <button type="button" onClick={cancel}>Cancelar</button>
    </div>
  </form>;
}

function EntitySecrets({ kind, id, characters }) {
  const [draft,setDraft] = useState(null);
  const load = useCallback(() => campaignChronicle.list("entity_secrets","label",{ kind, entity_id: String(id) }),[kind,id]);
  const { data,error,refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  return <section className="chronicle-flow">
    {(error || mutation.error) && <p role="alert">{error || mutation.error}</p>}
    {data?.length === 0 && <p>No hay información adicional visible.</p>}
    {data?.length > 0 && <ul className="chronicle-list">{data.map((row) => <li key={row.id}>
      <strong>{row.label}</strong>
      <p className="chronicle-pre">{row.content}</p>
      {characters && <div className="row">
        <small>{secretAudiences.find(({ id }) => id === row.audience)?.name}</small>
        <button type="button" onClick={() => setDraft(row)}>Editar información</button>
        <button type="button" disabled={mutation.busy} onClick={() => {
          if (window.confirm("¿Retirar esta información adicional?")) mutation.run(async () => {
            const { error } = await supabase.from("entity_secrets").delete().eq("id",row.id);
            if (error) throw error;
          });
        }}>Retirar información</button>
      </div>}
    </li>)}</ul>}
    {characters && !draft && <button type="button" onClick={() => setDraft({})}>Añadir información</button>}
    {draft && <SecretEditor key={draft.id ?? "new"} draft={draft} characters={characters}
      busy={mutation.busy} cancel={() => setDraft(null)} save={async (fields) => {
        if (await mutation.run(() => campaignChronicle.save("entity_secrets",
          draft.id ? fields : { ...fields, kind, entity_id: String(id) },draft.id))) setDraft(null);
      }} />}
  </section>;
}

export function VisibilityEditor({ kind, id, characters }) {
  const [open, setOpen] = useState(false);
  return <details className="entity-visibility" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{characters ? "Visibilidad e información adicional" : "Información adicional"}</summary>
    {open && <>
      {characters && <VisibilityForm key={`${kind}:${id}`} kind={kind} id={id} characters={characters} />}
      <EntitySecrets key={`info:${kind}:${id}`} kind={kind} id={id} characters={characters} />
    </>}
  </details>;
}
