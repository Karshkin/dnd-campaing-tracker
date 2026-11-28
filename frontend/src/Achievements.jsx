import { useCallback, useState } from "react";
import { Award, Crown, Medal, Shield, Star, Trophy } from "lucide-react";
import { campaignChronicle, groupInventory, supabase } from "./campaign";
import { useCampaignMutation, useCampaignQuery } from "./ChronicleControls";

const kinds = { achievement: "Logro", title: "Título", recognition: "Reconocimiento" };
const visibility = { recipient: "Solo destinatarios", campaign: "Toda la campaña", director: "Solo dirección" };
const icons = { award: [Award, "Distintivo"], crown: [Crown, "Corona"], medal: [Medal, "Medalla"], shield: [Shield, "Escudo"], star: [Star, "Estrella"], trophy: [Trophy, "Trofeo"] };

function AchievementForm({ draft, subjects, sessions, busy, save, cancel }) {
  return <form className="form" onSubmit={(event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (!draft.id) {
      const [kind, subject] = values.subject.split(":");
      values[kind === "character" ? "character_id" : "group_id"] = Number(subject);
    }
    delete values.subject;
    values.session_id ||= null;
    save(values);
  }}>
    {!draft.id && <label>Destinatario <select required name="subject" defaultValue="">
      <option value="" disabled>Selecciona un destinatario</option>
      {subjects.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
    </select></label>}
    <label>Tipo <select name="kind" defaultValue={draft.kind ?? "achievement"}>
      {Object.entries(kinds).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    <label>Nombre <input name="name" required maxLength={120} defaultValue={draft.name} /></label>
    <label>Descripción <textarea name="description" maxLength={10000} defaultValue={draft.description} /></label>
    <label>Recompensa asociada <input name="reward" maxLength={2000} defaultValue={draft.reward} /></label>
    <label>Icono <select name="icon" defaultValue={draft.icon ?? "award"}>
      {Object.entries(icons).map(([id,[,label]]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    <label>Fecha de obtención <input name="earned_on" type="date" required
      defaultValue={draft.earned_on ?? new Date().toLocaleDateString("en-CA")} /></label>
    <label>Sesión <select name="session_id" defaultValue={draft.session_id ?? ""}>
      <option value="">Sin sesión</option>
      {sessions.map(({ id,title }) => <option key={id} value={id}>{title}</option>)}
    </select></label>
    <label>Visibilidad <select name="visibility" defaultValue={draft.visibility ?? "recipient"}>
      {Object.entries(visibility).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    <div className="chronicle-actions">
      <button disabled={busy}>Guardar distinción</button>
      <button type="button" onClick={cancel}>Cancelar</button>
    </div>
  </form>;
}

export function Achievements({ director, characterId, characters = [], groupsOnly = false }) {
  const [draft,setDraft] = useState(null);
  const [withdrawing,setWithdrawing] = useState(null);
  const load = useCallback(async () => {
    let query = supabase.from("campaign_achievements").select().order("earned_on", { ascending: false });
    if (characterId) query = query.eq("character_id",characterId);
    else if (groupsOnly) query = query.not("group_id","is",null);
    const [{ data: rows,error },sessions,{ groups }] = await Promise.all([
      query, campaignChronicle.list("chronicle_sessions","played_on"),
      !characterId && groupsOnly ? groupInventory.groups() : Promise.resolve({ groups: [] }),
    ]);
    if (error) throw error;
    return { rows,sessions,groups };
  }, [characterId,groupsOnly]);
  const { data,error,refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  const heading = groupsOnly ? "Logros del grupo" : "Logros y títulos";
  const subjects = groupsOnly
    ? (data?.groups ?? []).map(({ id,name }) => ({ id: `group:${id}`, label: name }))
    : characters.map(({ id,name }) => ({ id: `character:${id}`, label: name }));
  return <section className="chronicle-panel chronicle-flow">
    <h3>{heading}</h3>
    {(error || mutation.error) && <p role="alert">{error || mutation.error}</p>}
    {!data && !error && <p role="status">Cargando distinciones…</p>}
    {data && director && subjects.length > 0 && !draft && <button type="button" onClick={() => setDraft({})}>Otorgar distinción</button>}
    {draft && <AchievementForm key={draft.id ?? "new"} draft={draft} subjects={subjects} sessions={data.sessions}
      busy={mutation.busy} cancel={() => setDraft(null)} save={async (values) => {
        if (await mutation.run(() => campaignChronicle.save("campaign_achievements",values,draft.id))) setDraft(null);
      }} />}
    {data?.rows.length === 0 && <p>No hay distinciones visibles.</p>}
    {data?.rows.length > 0 && <ul className="chronicle-list">{data.rows.map((row) => {
      const [Icon] = icons[row.icon];
      const session = data.sessions.find(({ id }) => id === row.session_id);
      const group = data.groups.find(({ id }) => id === row.group_id);
      return <li key={row.id} className="chronicle-panel">
        <h4 className="row"><Icon size={19} aria-hidden="true" /> {row.name}</h4>
        <p>{[kinds[row.kind], group?.name, row.earned_on, session?.title].filter(Boolean).join(" · ")}</p>
        {row.description && <p className="chronicle-pre">{row.description}</p>}
        {row.reward && <p>Recompensa · {row.reward}</p>}
        {director && <div className="chronicle-actions">
          <button type="button" onClick={() => setDraft(row)}>Editar</button>
          {withdrawing === row.id ? <>
            <button type="button" disabled={mutation.busy} onClick={async () => {
              if (await mutation.run(async () => {
                const { error } = await supabase.from("campaign_achievements").delete().eq("id",row.id);
                if (error) throw error;
              })) setWithdrawing(null);
            }}>Confirmar retirada</button>
            <button type="button" onClick={() => setWithdrawing(null)}>Cancelar</button>
          </> : <button type="button" onClick={() => setWithdrawing(row.id)}>Retirar</button>}
        </div>}
      </li>;
    })}</ul>}
  </section>;
}
