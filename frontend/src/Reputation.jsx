import { useCallback, useState } from "react";
import { campaignChronicle } from "./campaign";
import { useCampaignQuery, useCampaignMutation, SelectRow } from "./ChronicleControls";

export function reputationRank(score) {
  if (score <= -76) return "Hostil";
  if (score <= -41) return "Enemigo";
  if (score <= -11) return "Desconfiado";
  if (score <= 10) return "Neutral";
  if (score <= 40) return "Amistoso";
  if (score <= 75) return "Aliado";
  return "Venerado";
}

export function Reputation({ organizationId, director }) {
  const load = useCallback(() => campaignChronicle.factions(organizationId), [organizationId]);
  const { data, error, refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  const [group, setGroup] = useState("");
  const [reason, setReason] = useState("");
  const [session, setSession] = useState("");
  const [custom, setCustom] = useState("");
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando reputación…</p>;
  const [scores, history, { groups }, sessions] = data;
  const available = groups.filter(({ id }) => scores.some((row) => row.group_id === id));
  const selected = available.find(({ id }) => String(id) === group) ?? available[0];
  if (!selected) return null;
  const row = scores.find(({ group_id }) => group_id === selected.id);
  const change = (fields) => mutation.run(() => campaignChronicle.action("reputation", {
    organization_id: organizationId, group_id: selected.id, ...fields,
  }));
  const adjust = async (delta) => {
    if (await change({ delta, reason, session_id: session || null })) setReason("");
  };
  return (
    <section className="character-sheet-panel chronicle-panel">
      <h4>Reputación</h4>
      <SelectRow label="Grupo" rows={available} value={selected.id} onChange={setGroup} />
      <p><strong>{reputationRank(row.score)}</strong> · {row.score > 0 ? "+" : ""}{row.score}</p>
      <meter min="-100" max="100" low="-10" high="10" optimum="100" value={row.score} aria-label="Reputación" />
      {director && <form className="form" onSubmit={(event) => {
        event.preventDefault();
        adjust(Number(custom));
      }}>
        <label>Visible para el grupo <input type="checkbox" checked={row.visible} disabled={mutation.busy}
          onChange={(event) => change({ visible: event.target.checked })} /></label>
        <label>Motivo <input required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <SelectRow label="Sesión" rows={sessions} value={session} onChange={setSession} empty="Sin sesión" />
        <div className="chronicle-actions">
          {[-10, -5, 5, 10].map((delta) => <button type="button" key={delta}
            disabled={mutation.busy || !reason.trim()} onClick={() => adjust(delta)}>{delta > 0 && "+"}{delta}</button>)}
          <label>Ajuste personalizado <input type="number" step="1" min="-2147483648" max="2147483647"
            value={custom} onChange={(e) => setCustom(e.target.value)} /></label>
          <button disabled={mutation.busy || !reason.trim() || !Number(custom)}>Aplicar</button>
        </div>
      </form>}
      {mutation.error && <p role="alert">{mutation.error}</p>}
      <details><summary>Historial</summary>
        <ul>{history.filter(({ group_id }) => group_id === selected.id).slice().reverse().map((entry) => (
          <li key={entry.id}><time>{new Date(entry.created_at).toLocaleString()}</time> · {entry.author_name} ·
            {" "}{entry.previous_score} → {entry.score} ({entry.requested > 0 ? "+" : ""}{entry.requested}) · {entry.reason}
            {entry.session_id && <> · {sessions.find(({ id }) => id === entry.session_id)?.title}</>}
          </li>
        ))}</ul>
      </details>
    </section>
  );
}
