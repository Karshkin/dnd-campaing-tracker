import { useCallback, useState } from "react";
import { supabase } from "./campaign";
import { SelectRow, useCampaignMutation, useCampaignQuery } from "./ChronicleControls";
import { VisibilityEditor } from "./VisibilityEditor";
import { formatHarptos, fromHarptosDay, periodsInYear, toHarptosDay } from "./harptos";

async function value(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function WorldDate({ initial, onChange }) {
  const start = fromHarptosDay(initial);
  const [year, setYear] = useState(start.year);
  const [period, setPeriod] = useState(start.period);
  const [day, setDay] = useState(start.day);
  const choices = periodsInYear(year);
  function update(y, p, d) {
    const safePeriod = choices[p]?.[0] === "Shieldmeet" && y % 4 !== 0 ? 9 : p;
    const safeDay = Math.min(d, periodsInYear(y)[safePeriod][1]);
    setYear(y); setPeriod(safePeriod); setDay(safeDay);
    onChange(Number.isInteger(y) && y > 0 && Number.isInteger(safeDay) && safeDay > 0 ? toHarptosDay(y, safePeriod, safeDay) : null);
  }
  return <div className="chronicle-actions">
    <label>Año CV <input type="number" min={1} max={99999} required value={year || ""}
      onChange={(event) => update(Number(event.target.value),period,day)} /></label>
    <SelectRow label="Mes o festividad" rows={choices.flatMap(([name, count], id) => count ? [{ id, name }] : [])}
      value={period} onChange={(value) => update(year,Number(value),day)} />
    <label>Día <input type="number" min={1} max={choices[period][1]} required value={day || ""}
      onChange={(event) => update(year,period,Number(event.target.value))} /></label>
  </div>;
}

export function HarptosCalendar({ director, characters }) {
  const load = useCallback(async () => {
    const [clock, events, sessions] = await Promise.all([
      value(supabase.from("harptos_clock").select("world_day").maybeSingle()),
      value(supabase.from("harptos_events").select().order("world_day").order("id")),
      value(supabase.from("chronicle_sessions").select("id,title,played_on").order("played_on")),
    ]);
    return { clock, events, sessions };
  }, []);
  const { data, error, refresh } = useCampaignQuery(load);
  const mutation = useCampaignMutation(refresh);
  const [editing, setEditing] = useState(null);
  const [worldDay, setWorldDay] = useState(null);
  const [clockDraft, setClockDraft] = useState(null);
  const [session, setSession] = useState("");
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando calendario…</p>;
  const current = data.clock?.world_day;
  return <article className="card chronicle-flow">
    <h2>Calendario de Harptos</h2>
    <p>{current === undefined ? "Fecha de campaña sin establecer" : formatHarptos(current)}</p>
    {mutation.error && <p role="alert">{mutation.error}</p>}
    {director && <details><summary>Fecha y avance del mundo</summary>
      <form className="form" onSubmit={(event) => {
        event.preventDefault();
        mutation.run(() => value(supabase.rpc("set_harptos_date", { day_number: clockDraft ?? current ?? 0 })));
      }}>
        <WorldDate key={current ?? "initial"} initial={current ?? 0} onChange={setClockDraft} />
        <button disabled={mutation.busy}>Guardar fecha</button>
      </form>
      {current !== undefined && <form className="form" onSubmit={(event) => {
        event.preventDefault();
        const days = Number(new FormData(event.currentTarget).get("days"));
        mutation.run(async () => { await value(supabase.rpc("set_harptos_date", { advance: days })); setClockDraft(null); });
      }}>
        <label>Días transcurridos <input name="days" type="number" min={1} max={36500} defaultValue={1} required /></label>
        <button disabled={mutation.busy}>Avanzar calendario</button>
      </form>}
    </details>}
    {director && <button type="button" onClick={() => { setEditing({}); setSession(""); setWorldDay(current ?? 0); }}>Nuevo acontecimiento</button>}
    {editing && <form className="form" key={editing.id ?? "new"} onSubmit={async (event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const draft = {
        title: fields.get("title"), notes: fields.get("notes"), kind: fields.get("kind"),
        duration: Number(fields.get("duration")), private: fields.has("private"),
        world_day: worldDay, session_id: session || null,
      };
      const table = supabase.from("harptos_events");
      if (await mutation.run(() => value((editing.id ? table.update(draft).eq("id", editing.id) : table.insert(draft)).select().single()))) setEditing(null);
    }}>
      <label>Título <input name="title" maxLength={120} defaultValue={editing.title} required /></label>
      <WorldDate initial={editing.world_day ?? current ?? 0} onChange={setWorldDay} />
      <label>Tipo <select name="kind" defaultValue={editing.kind ?? "event"}>
        <option value="event">Acontecimiento</option><option value="travel">Viaje</option>
      </select></label>
      <label>Duración en días <input name="duration" type="number" min={0} max={36500} defaultValue={editing.duration ?? 0} /></label>
      <SelectRow label="Sesión real" rows={data.sessions.map((row) => ({ ...row, title: `${row.title} · ${row.played_on}` }))}
        value={session} onChange={setSession} empty="Sin sesión" />
      <label><input type="checkbox" name="private" defaultChecked={editing.private} /> Privado del director</label>
      <label>Notas <textarea name="notes" defaultValue={editing.notes} /></label>
      <div className="chronicle-actions"><button disabled={mutation.busy}>Guardar acontecimiento</button>
        <button type="button" onClick={() => setEditing(null)}>Cancelar</button></div>
    </form>}
    {data.events.length === 0 && <p>No hay acontecimientos visibles.</p>}
    <ul className="chronicle-list">{data.events.map((event) => <li key={event.id} className="chronicle-panel">
      <h3>{event.title}</h3>
      <p>{formatHarptos(event.world_day)}{event.duration > 0 && ` · ${event.duration} días`}
        {event.kind === "travel" && " · Viaje"}{event.private && " · Privado"}</p>
      {event.session_id && <p>Sesión real · {data.sessions.find(({ id }) => id === event.session_id)?.played_on}</p>}
      <p className="chronicle-pre">{event.notes}</p>
      {director && <div className="chronicle-actions">
        <button type="button" onClick={() => { setEditing(event); setSession(event.session_id ?? ""); setWorldDay(event.world_day); }}>Editar acontecimiento</button>
        <button type="button" onClick={() => {
          if (window.confirm(`¿Eliminar «${event.title}»?`)) mutation.run(() => value(supabase.from("harptos_events").delete().eq("id", event.id)));
        }}>Eliminar acontecimiento</button>
      </div>}
      <VisibilityEditor kind="harptos_events" id={event.id} characters={director && !event.private ? characters : null} />
    </li>)}</ul>
  </article>;
}
