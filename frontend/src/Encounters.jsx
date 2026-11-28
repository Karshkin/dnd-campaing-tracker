import { useCallback, useState } from "react";
import { campaignChronicle, groupInventory, supabase } from "./campaign";
import { SelectRow, useCampaignMutation, useCampaignQuery } from "./ChronicleControls";
import { MovementEditor } from "./Treasury";
import { PageHeader } from "./CampaignShell";
import { encounterBudget } from "./encounterBudget";
import { VisibilityEditor } from "./VisibilityEditor";

const phases = { prepared: "Preparado", running: "En combate", completed: "Finalizado" };
const conditions = ["Agotamiento", "Agarrado", "Asustado", "Aturdido", "Cegado", "Derribado", "Ensordecido", "Envenenado", "Hechizado",
  "Incapacitado", "Inconsciente", "Invisible", "Paralizado", "Petrificado", "Restringido"];

async function value(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function EncounterEditor({ sessions, locations, busy, onSave }) {
  const [session, setSession] = useState("");
  const [place, setPlace] = useState("");
  return <form className="form" onSubmit={async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (await onSave({
      title: fields.get("title"), experience: Number(fields.get("experience")), rewards: fields.get("rewards"),
      session_id: session || null, place_id: place ? Number(place) : null,
    })) form.reset();
  }}>
    <label>Título <input name="title" required maxLength={120} /></label>
    <div className="chronicle-actions">
      <SelectRow label="Sesión" rows={sessions} value={session} onChange={setSession} empty="Sin sesión" />
      <SelectRow label="Localización" rows={locations} value={place} onChange={setPlace} empty="Sin localización" />
      <label>Experiencia de recompensa <input name="experience" type="number" min={0} defaultValue={0} required /></label>
    </div>
    <label>Recompensas <textarea name="rewards" /></label>
    <button disabled={busy}>Preparar encuentro</button>
  </form>;
}

function CombatantEditor({ encounter, characters, creatures, npcs, busy, onSave }) {
  const [origin, setOrigin] = useState("");
  const [target, setTarget] = useState("");
  const units = { character: characters, creature: creatures, npc: npcs }[origin] ?? [];
  const selected = units.find(({ id }) => id === Number(target));
  return <form className="form" onSubmit={async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const count = origin === "character" ? 1 : Number(fields.get("count"));
    const name = fields.get("name").trim() || selected?.name;
    if (!name) return;
    const hp = Number(fields.get("hp"));
    if (await onSave(Array.from({ length: count }, (_, index) => ({
      encounter_id: encounter.id, name: count === 1 ? name : `${name} ${index + 1}`,
      creature_id: origin === "creature" ? selected?.id : null, character_id: origin === "character" ? selected?.id : null,
      npc_id: origin === "npc" ? selected?.id : null,
      initiative: Number(fields.get("initiative")), maximum_hp: hp, hp, player_visible: fields.has("visible"),
      experience: Number(fields.get("experience")), notes: fields.get("notes"),
    })))) form.reset();
  }}>
    <div className="chronicle-actions">
      <SelectRow label="Origen" rows={[{ id: "creature", name: "Bestiario" }, { id: "character", name: "Personaje" }, { id: "npc", name: "PNJ individual" }]}
        value={origin} onChange={(next) => { setOrigin(next); setTarget(""); }} empty="Combatiente individual" />
      {origin && <SelectRow label="Ficha de origen" rows={units} value={target} onChange={setTarget} empty="Selecciona una ficha" required />}
      <label>Nombre <input name="name" maxLength={110} required={!selected} /></label>
      {origin !== "character" && <label>Cantidad <input name="count" type="number" min={1} max={25} defaultValue={1} required /></label>}
      <label>Iniciativa <input name="initiative" type="number" defaultValue={0} required /></label>
      <label>PG máximos <input key={selected?.id} name="hp" type="number" min={1} max={1000000}
        defaultValue={Number.parseInt(selected?.hit_points,10) || 1} required /></label>
      <label>PX del combatiente <input name="experience" type="number" min={0} defaultValue={0} required /></label>
    </div>
    {selected?.creature_type && <p>{selected.creature_type} · VD {selected.challenge_rating} · CA {selected.armor_class}</p>}
    <label>Notas de combate <textarea name="notes" /></label>
    <label><input type="checkbox" name="visible" defaultChecked /> Visible para jugadores</label>
    <button disabled={busy}>Añadir combatientes</button>
  </form>;
}

function Combatants({ rows, active, complete, creatures, mutation }) {
  return <ul className="chronicle-list encounter-roster">{rows.map((unit) => {
    const stats = creatures.find(({ id }) => id === unit.creature_id);
    return <li key={unit.id} className="chronicle-panel" data-current={unit.id === active}>
      <div className="row"><h4>{unit.name}</h4>
        {unit.id === active && <span className="turn-label">Turno actual</span>}
      </div>
      {stats && <p>CA {stats.armor_class} · VD {stats.challenge_rating} · {stats.abilities}</p>}
      <form className="form" key={JSON.stringify(unit)} onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const changes = {
          initiative: Number(values.get("initiative")), hp: Number(values.get("hp")),
          maximum_hp: Number(values.get("maximum")), temporary_hp: Number(values.get("temporary")),
          notes: values.get("notes"), conditions: values.getAll("condition"), player_visible: values.has("visible"),
        };
        mutation.run(() => value(supabase.from("encounter_combatants").update(changes).eq("id", unit.id).select("id").single()));
      }}>
        <fieldset disabled={complete || mutation.busy}>
          <div className="combat-stats">
            <label>Iniciativa <input name="initiative" type="number" required defaultValue={unit.initiative} /></label>
            <label>PG actuales <input name="hp" type="number" min={0} max={1000000} required defaultValue={unit.hp} /></label>
            <label>PG máximos <input name="maximum" type="number" min={1} max={1000000} required defaultValue={unit.maximum_hp} /></label>
            <label>PG temporales <input name="temporary" type="number" min={0} max={1000000} required defaultValue={unit.temporary_hp} /></label>
          </div>
          <details><summary>Condiciones y notas</summary>
            <div className="choice-options">{conditions.map((name) => <label key={name}>
              <input type="checkbox" name="condition" value={name} defaultChecked={unit.conditions.includes(name)} /> {name}
            </label>)}</div>
            <label>Notas <textarea name="notes" defaultValue={unit.notes} /></label>
            <label><input type="checkbox" name="visible" defaultChecked={unit.player_visible} /> Visible para jugadores</label>
          </details>
          {!complete && <button>Guardar estado</button>}
        </fieldset>
      </form>
    </li>;
  })}</ul>;
}

function Encounter({ row, director, characters, creatures, npcs, groups, onChange }) {
  const load = useCallback(async () => {
    const [turns, units] = await Promise.all([
      value(supabase.rpc("visible_encounter_turns", { target: row.id })),
      director ? value(supabase.from("encounter_combatants").select().eq("encounter_id", row.id).order("initiative", { ascending: false }).order("id")) : [],
    ]);
    return { turns, units };
  }, [director, row.id, row.revision]);
  const { data, error, refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(async () => { await onChange(); await refresh(); });
  const [group, setGroup] = useState("");
  const [loot, setLoot] = useState([]);

  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando orden de turnos…</p>;
  const { units, turns } = data;
  const currentTurn = turns.find(({ current }) => current);
  const active = currentTurn?.id;
  const step = (action) => mutation.run(() => value(supabase.rpc("encounter_step", {
    target: row.id, action, expected: row.revision, loot: action === "complete" ? loot : [],
  })));
  const players = characters.filter(({ id }) => units.some(({ character_id }) => character_id === id));
  const xp = units.filter(({ character_id }) => !character_id).reduce((sum, unit) => sum + unit.experience, 0);
  const [low,moderate,high] = encounterBudget(players.map(({ level }) => level));
  const difficulty = xp <= low ? "Baja" : xp <= moderate ? "Moderada" : xp <= high ? "Alta" : "Supera el presupuesto alto";
  return <section className="chronicle-flow">
    <header className="encounter-status row">
      <div>
        <h3>{row.title}</h3>
        <p>{phases[row.phase]}{row.round > 0 && ` · Ronda ${row.round}`}
          {currentTurn && ` · Turno de ${currentTurn.name}`}</p>
      </div>
      {director && row.phase === "running" && <button type="button" className="primary-action"
        disabled={mutation.busy || !units.length} onClick={() => step("next")}>Siguiente turno</button>}
    </header>
    {mutation.error && <p role="alert">{mutation.error}</p>}
    {!director && <ol>{turns.map((turn) => <li key={turn.id}>{turn.current && "Turno · "}{turn.name} · {turn.initiative}</li>)}</ol>}
    {row.phase === "completed" && <p>{row.experience} PX · {row.rewards}</p>}
    {director && <>
      {row.phase !== "completed" && <details><summary>Añadir combatientes</summary>
        <CombatantEditor encounter={row} characters={characters} creatures={creatures} npcs={npcs} busy={mutation.busy}
          onSave={(draft) => mutation.run(() => value(supabase.from("encounter_combatants").insert(draft)))} />
      </details>}
      <p>{players.length} participantes{players.length > 0 && ` · niveles ${players.map(({ level }) => level).join(", ")}`} · {xp} PX de enemigos</p>
      {players.length > 0 && <div className="chronicle-panel">
        <h4>Dificultad estimada · {difficulty}</h4>
        <p>Presupuesto D&amp;D 2024 · Baja {low} PX · Moderada {moderate} PX · Alta {high} PX</p>
      </div>}
      {row.phase === "prepared" && <button type="button" disabled={!units.length || mutation.busy} onClick={() => step("start")}>Iniciar combate</button>}
      {row.phase === "running" && <>
        <details><summary>Cierre y botín</summary>
          <SelectRow label="Grupo que recibe el botín" rows={groups} value={group} onChange={setGroup} empty="Selecciona un grupo" />
          {group && <LootForm group={Number(group)} busy={mutation.busy} onAdd={(movement) => setLoot([...loot,movement])} />}
          <ul>{loot.map((item, index) => <li key={index}>{item.quantity} × {item.name || item.denomination}
            <button type="button" onClick={() => setLoot(loot.filter((_, i) => i !== index))}>Quitar</button>
          </li>)}</ul>
          <button type="button" disabled={mutation.busy} onClick={() => {
            if (window.confirm("¿Completar el encuentro y entregar el botín?")) step("complete");
          }}>Completar encuentro</button>
        </details>
      </>}
      <VisibilityEditor kind="encounters" id={row.id} characters={characters} />
      <Combatants rows={units} active={active} complete={row.phase === "completed"} creatures={creatures} mutation={mutation} />
    </>}
  </section>;
}

function LootForm({ group, busy, onAdd }) {
  return <MovementEditor groupId={group} items={[]} characters={[]} busy={busy} depositOnly
    onAdd={(movement) => { onAdd(movement); return true; }} />;
}

export function Encounters({ director, characters, creatures, npcs }) {
  const load = useCallback(async () => {
    const [encounters, sessions, locations, groups] = await Promise.all([
      director ? value(supabase.from("encounters").select("id,title,phase,round,revision,experience,rewards,session_id,place_id").order("title"))
        : value(supabase.rpc("visible_encounters")),
      director ? campaignChronicle.list("chronicle_sessions", "played_on") : [],
      director ? campaignChronicle.list("points_of_interest", "title") : [],
      director ? groupInventory.groups() : { groups: [] },
    ]);
    return { encounters, sessions, locations, groups: groups.groups.filter(({ archived_at }) => !archived_at) };
  }, [director]);
  const { data, error, refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  const [selection, setSelection] = useState("");
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando encuentros…</p>;
  const row = data.encounters.find(({ id }) => id === selection) ?? data.encounters[0];
  return <article className="chronicle-flow encounter-page">
    <PageHeader title="Encuentros" />
    {mutation.error && <p role="alert">{mutation.error}</p>}
    {director && <details><summary>Nuevo encuentro</summary>
      <EncounterEditor sessions={data.sessions} locations={data.locations} busy={mutation.busy} onSave={(draft) =>
        mutation.run(async () => {
          const created = await value(supabase.from("encounters").insert(draft).select("id").single());
          setSelection(created.id);
        })} />
    </details>}
    {row ? <>
      <SelectRow label="Encuentro" rows={data.encounters} value={row.id} onChange={setSelection} />
      <Encounter key={row.id} row={row} director={director} characters={characters} creatures={creatures}
        npcs={npcs} groups={data.groups} onChange={refresh} />
    </> : <p>No hay encuentros visibles.</p>}
  </article>;
}
