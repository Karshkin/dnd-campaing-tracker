import { useCallback, useState } from "react";
import { campaignVisibility } from "./campaign";
import { SelectRow, useCampaignMutation, useCampaignQuery } from "./ChronicleControls";

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

export function VisibilityEditor({ kind, id, characters }) {
  const [open, setOpen] = useState(false);
  if (!characters) return null;
  return <details className="entity-visibility" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Visibilidad</summary>
    {open && <VisibilityForm key={`${kind}:${id}`} kind={kind} id={id} characters={characters} />}
  </details>;
}
