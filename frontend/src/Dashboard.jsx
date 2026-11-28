import { useCallback } from "react";
import { supabase } from "./campaign";
import { useCampaignQuery } from "./ChronicleControls";

const sourceLabels = {
  diary_entries: "Diario", chronicle_quests: "Misiones", chronicle_sessions: "Sesiones",
  organizations: "Organizaciones", treasury_history: "Inventario",
};
const actionLabels = { insert: "Creación", update: "Actualización", delete: "Eliminación" };
const dateLabel = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
  .format(new Date(value.length === 10 ? `${value}T12:00:00` : value));

async function read(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function optional(query) {
  const { data, error } = await query;
  if (["PGRST202","PGRST205","42P01"].includes(error?.code)) return null;
  if (error) throw error;
  return data;
}

export function Dashboard({ director, characters, navigate, views }) {
  const load = useCallback(async () => {
    const today = new Date().toLocaleDateString("sv-SE");
    const [sessions, quests, diary, wallets, factions, groups, activity, encounters, clock, letters] = await Promise.all([
      read(supabase.from("chronicle_sessions").select("id,title,played_on,status").gte("played_on", today)
        .neq("status", "closed").order("played_on").limit(1)),
      read(supabase.from("chronicle_quests").select("id,title,status").eq("status", "active").order("title").limit(5)),
      read(supabase.from("diary_entries").select("id,title,created_at").order("created_at", { ascending: false }).limit(5)),
      read(supabase.from("treasury_wallet").select("group_id,denomination,balance").not("group_id", "is", null).limit(40)),
      read(supabase.from("faction_reputation").select("score,organization_id,group_id").neq("score", 0).limit(8)),
      read(supabase.from("inventory_groups").select("id,name").order("name").limit(30)),
      read(supabase.from("campaign_activity").select("id,entity_kind,action,occurred_at").order("occurred_at", { ascending: false }).limit(12)),
      optional(supabase.rpc("visible_encounters")),
      optional(supabase.from("harptos_clock").select("world_day").maybeSingle()),
      optional(supabase.from("campaign_documents").select("id,title").order("created_at",{ ascending: false }).limit(3)),
    ]);
    const organizationIds = [...new Set(factions.map(({ organization_id }) => organization_id))];
    const organizations = organizationIds.length
      ? await read(supabase.from("organizations").select("id,name").in("id", organizationIds)) : [];
    const calendar = clock ? await optional(supabase.from("harptos_events").select("id,title,world_day,kind")
      .gte("world_day",clock.world_day).order("world_day").limit(3)) : null;
    return { sessions, quests, diary, wallets, factions, groups, activity, organizations, encounters, calendar, letters };
  }, []);
  const { data, error, refresh } = useCampaignQuery(load);
  if (error) return <section className="card"><p role="alert">{error}</p><button onClick={refresh}>Reintentar</button></section>;
  if (!data) return <section className="card"><p role="status">Cargando inicio…</p></section>;
  const next = data.sessions[0];
  const groupName = (id) => data.groups.find((group) => group.id === id)?.name;
  return <div className="dashboard">
    <header className="dashboard-header">
      <div><h2>{director ? "Panel del director" : "Inicio de campaña"}</h2>
        {next ? <p>Próxima sesión · <strong>{next.title}</strong> · {dateLabel(next.played_on)}</p>
          : <p>No hay una próxima sesión anunciada.</p>}
      </div>
      {director && <button type="button" onClick={() => navigate("admin")}>Gestionar campaña</button>}
    </header>
    <div className="grid">
      {!director && <section className="card"><h3>Mis personajes</h3>
        {characters.length ? <ul>{characters.map(({ id, name }) => <li key={id}>{name}</li>)}</ul> : <p>Todavía no tienes personajes.</p>}
        <button type="button" onClick={() => navigate("characters")}>Personajes</button>
      </section>}
      <section className="card"><h3>Misiones activas</h3>
        {data.quests.length ? <ul>{data.quests.map(({ id, title }) => <li key={id}>{title}</li>)}</ul> : <p>No hay misiones activas visibles.</p>}
        <button type="button" onClick={() => navigate("chronicle")}>Abrir crónica</button>
      </section>
      <section className="card"><h3>Entradas recientes</h3>
        {data.diary.length ? <ul>{data.diary.map(({ id, title, created_at }) => <li key={id}>{title} · {dateLabel(created_at)}</li>)}</ul>
          : <p>Aún no hay entradas visibles.</p>}
      </section>
      <section className="card"><h3>Monederos de grupo</h3>
        {data.wallets.length ? <ul>{data.wallets.map(({ group_id, denomination, balance }) => (
          <li key={`${group_id}:${denomination}`}>{groupName(group_id)} · {balance} {denomination}</li>
        ))}</ul> : <p>No hay saldos visibles.</p>}
        <button type="button" onClick={() => navigate("inventory")}>Abrir inventario</button>
      </section>
      <section className="card"><h3>Reputación</h3>
        {data.factions.length ? <ul>{data.factions.map(({ group_id, organization_id, score }) => (
          <li key={`${group_id}:${organization_id}`}>
            {data.organizations.find(({ id }) => id === organization_id)?.name} · {groupName(group_id)} · {score}
          </li>
        ))}</ul> : <p>No hay cambios visibles de reputación.</p>}
      </section>
      {data.encounters && <section className="card"><h3>Encuentros</h3>
        {data.encounters.length ? <ul>{data.encounters.slice(0,5).map(({ id,title,phase,round }) => (
          <li key={id}>{title} · {phase === "running" ? `Ronda ${round}` : phase === "completed" ? "Finalizado" : "Preparado"}</li>
        ))}</ul> : <p>No hay encuentros visibles.</p>}
        {views.includes("encounters") && <button type="button" onClick={() => navigate("encounters")}>Abrir encuentros</button>}
      </section>}
      {data.calendar && <section className="card"><h3>Próximos acontecimientos</h3>
        {data.calendar.length ? <ul>{data.calendar.map(({ id,title }) => <li key={id}>{title}</li>)}</ul>
          : <p>No hay acontecimientos próximos.</p>}
        {views.includes("calendar") && <button type="button" onClick={() => navigate("calendar")}>Abrir calendario</button>}
      </section>}
      {data.letters && <section className="card"><h3>Correspondencia reciente</h3>
        {data.letters.length ? <ul>{data.letters.map(({ id,title }) => <li key={id}>{title}</li>)}</ul> : <p>No hay documentos visibles.</p>}
        {views.includes("correspondence") && <button type="button" onClick={() => navigate("correspondence")}>Abrir correspondencia</button>}
      </section>}
      <section className="card wide"><h3>Actividad reciente</h3>
        {data.activity.length ? <ul>{data.activity.map(({ id, entity_kind, action, occurred_at }) => (
          <li key={id}>{sourceLabels[entity_kind]} · {actionLabels[action]} · {dateLabel(occurred_at)}</li>
        ))}</ul> : <p>Aún no hay actividad visible.</p>}
      </section>
    </div>
  </div>;
}
