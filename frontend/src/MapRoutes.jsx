import { useCallback, useState } from "react";
import { campaignChronicle, supabase } from "./campaign";
import { useCampaignMutation, useCampaignQuery } from "./ChronicleControls";
import { VisibilityEditor } from "./VisibilityEditor";

export function useMapRoutes(mapId) {
  const load = useCallback(async () => {
    if (!mapId) return [];
    const { data,error } = await supabase.from("campaign_map_routes").select().eq("map_id",mapId).order("name");
    if (error) throw error;
    return data;
  }, [mapId]);
  const result = useCampaignQuery(load);
  return { ...result, data: result.data?.filter((route) => route.map_id === mapId) };
}

export function MapRouteOverlay({ routes, places }) {
  const coordinates = new Map(places.map(({ id,longitude,latitude }) => [id,`${longitude},${latitude}`]));
  return <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none"
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
    {routes.map(({ id,waypoints }) => waypoints.every((point) => coordinates.has(point)) && <polyline
      key={id} points={waypoints.map((point) => coordinates.get(point)).join(" ")} vectorEffect="non-scaling-stroke"
      fill="none" stroke="#a51d2d" strokeWidth="3" strokeDasharray="7 4" strokeLinejoin="round" />)}
  </svg>;
}

function RouteForm({ draft, places, busy, save, cancel }) {
  const [waypoints,setWaypoints] = useState(draft.waypoints ?? [null,null]);
  return <form className="form" onSubmit={(event) => {
    event.preventDefault();
    save({ ...Object.fromEntries(new FormData(event.currentTarget)), waypoints });
  }}>
    <label>Nombre <input name="name" required maxLength={120} defaultValue={draft.name} /></label>
    <label>Descripción <textarea name="description" maxLength={5000} defaultValue={draft.description} /></label>
    {waypoints.map((point,index) => <div key={index} className="row">
      <label>Parada {index + 1} <select required value={point ?? ""} onChange={(event) => {
        const id = Number(event.target.value) || null;
        setWaypoints((current) => current.map((value,i) => i === index ? id : value));
      }}>
        <option value="">Seleccionar localización</option>
        {places.map(({ id,title }) => <option key={id} value={id}>{title}</option>)}
      </select></label>
      {waypoints.length > 2 && <button type="button" onClick={() => setWaypoints((current) => current.filter((_,i) => i !== index))}>
        Quitar parada {index + 1}
      </button>}
    </div>)}
    <div className="row">
      <button type="button" disabled={waypoints.length >= 30} onClick={() => setWaypoints((current) => [...current,null])}>Añadir parada</button>
      <button disabled={busy}>Guardar ruta</button>
      <button type="button" onClick={cancel}>Cancelar</button>
    </div>
  </form>;
}

export function MapRoutes({ mapId, routes, places, director, characters, selected, select }) {
  const [draft,setDraft] = useState(null);
  const [remove,setRemove] = useState(null);
  const mutation = useCampaignMutation(routes.refresh);
  const lookup = new Map(places.map(({ id,title }) => [id,title]));
  return <section className="chronicle-panel chronicle-flow">
    <h3>Rutas del mapa</h3>
    {(routes.error || mutation.error) && <p role="alert">{routes.error || mutation.error}</p>}
    {director && places.length >= 2 && !draft && <button type="button" onClick={() => setDraft({})}>Trazar ruta</button>}
    {draft && <RouteForm key={draft.id ?? "new"} draft={draft} places={places} busy={mutation.busy}
      cancel={() => setDraft(null)} save={async (values) => {
        if (await mutation.run(async () => {
          const row = await campaignChronicle.save("campaign_map_routes", draft.id ? values : { ...values, map_id: mapId },draft.id);
          select(row.id);
        })) setDraft(null);
      }} />}
    {routes.data?.length === 0 && <p>No hay rutas visibles en este mapa.</p>}
    {routes.data?.length > 0 && <ul className="chronicle-list">{routes.data.map((route) => <li key={route.id}>
      <button type="button" aria-pressed={selected === route.id} onClick={() => select(selected === route.id ? null : route.id)}>{route.name}</button>
      {lookup.size > 0 && <p>{route.waypoints.map((id) => lookup.get(id) ?? "Localización eliminada").join(" → ")}</p>}
      {route.description && <p>{route.description}</p>}
      {director && <>
        <VisibilityEditor kind="campaign_map_routes" id={route.id} characters={characters} />
        <div className="row">
          <button type="button" onClick={() => setDraft(route)}>Editar ruta</button>
          {remove === route.id ? <>
            <button type="button" disabled={mutation.busy} onClick={async () => {
              if (await mutation.run(async () => {
                const { error } = await supabase.from("campaign_map_routes").delete().eq("id",route.id);
                if (error) throw error;
              })) { select(null); setRemove(null); }
            }}>Confirmar eliminación</button>
            <button type="button" onClick={() => setRemove(null)}>Cancelar</button>
          </> : <button type="button" onClick={() => setRemove(route.id)}>Eliminar ruta</button>}
        </div>
      </>}
    </li>)}</ul>}
  </section>;
}
