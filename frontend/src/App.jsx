import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const MAP_HEIGHT = 520;

function useApiData(path, defaultValue) {
  const [data, setData] = useState(defaultValue);

  const refresh = async () => {
    const response = await fetch(`${API_URL}${path}`);
    const payload = await response.json();
    setData(payload);
  };

  useEffect(() => {
    refresh();
  }, [path]);

  return [data, refresh];
}

function MapView({ events, onMapClick, readonly = false }) {
  const markers = useMemo(() => {
    return events.map((event) => ({
      ...event,
      top: `${event.latitude}%`,
      left: `${event.longitude}%`,
    }));
  }, [events]);

  return (
    <div>
      <div
        className={`map-wrapper ${readonly ? "" : "clickable"}`}
        onClick={(event) => {
          if (readonly) {
            return;
          }
          const bounds = event.currentTarget.getBoundingClientRect();
          const latitude = ((event.clientY - bounds.top) / bounds.height) * 100;
          const longitude = ((event.clientX - bounds.left) / bounds.width) * 100;
          onMapClick({ latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)) });
        }}
      >
        <img src="/map-placeholder.svg" alt="Campaign map" className="map-image" height={MAP_HEIGHT} />
        {markers.map((event) => (
          <button
            type="button"
            key={event.id}
            className={`marker marker-${event.event_type}`}
            style={{ top: event.top, left: event.left }}
            title={`${event.title}: ${event.description}`}
          />
        ))}
      </div>
      <small>Blue dots are events. Orange dots are quests.</small>
    </div>
  );
}

function App() {
  const [activeView, setActiveView] = useState("tracker");
  const [events, refreshEvents] = useApiData("/events", []);
  const [resources, refreshResources] = useApiData("/resources", []);
  const [diaryEntries, refreshDiaryEntries] = useApiData("/diary", []);

  const [eventDraft, setEventDraft] = useState({
    title: "",
    description: "",
    event_type: "event",
    latitude: 50,
    longitude: 50,
  });
  const [resourceDraft, setResourceDraft] = useState({ name: "", quantity: 0, notes: "" });
  const [diaryDraft, setDiaryDraft] = useState({ title: "", content: "" });

  const submitEvent = async (event) => {
    event.preventDefault();
    const response = await fetch(`${API_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventDraft),
    });
    if (response.ok) {
      setEventDraft({ title: "", description: "", event_type: "event", latitude: 50, longitude: 50 });
      refreshEvents();
    }
  };

  const deleteEvent = async (id) => {
    await fetch(`${API_URL}/events/${id}`, { method: "DELETE" });
    refreshEvents();
  };

  const submitResource = async (event) => {
    event.preventDefault();
    const response = await fetch(`${API_URL}/resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...resourceDraft, quantity: Number(resourceDraft.quantity) }),
    });
    if (response.ok) {
      setResourceDraft({ name: "", quantity: 0, notes: "" });
      refreshResources();
    }
  };

  const submitDiary = async (event) => {
    event.preventDefault();
    const response = await fetch(`${API_URL}/diary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(diaryDraft),
    });
    if (response.ok) {
      setDiaryDraft({ title: "", content: "" });
      refreshDiaryEntries();
    }
  };

  return (
    <main>
      <header>
        <h1>DnD Campaign Tracker</h1>
        <div className="tabs">
          <button type="button" onClick={() => setActiveView("tracker")} className={activeView === "tracker" ? "active" : ""}>
            Tracker
          </button>
          <button type="button" onClick={() => setActiveView("backoffice")} className={activeView === "backoffice" ? "active" : ""}>
            Backoffice
          </button>
        </div>
      </header>

      {activeView === "tracker" ? (
        <section className="grid">
          <article className="card wide">
            <h2>World Map</h2>
            <MapView events={events} readonly />
          </article>

          <article className="card">
            <h2>Party Resources</h2>
            <ul>
              {resources.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>: {item.quantity}
                  {item.notes ? ` (${item.notes})` : ""}
                </li>
              ))}
            </ul>
          </article>

          <article className="card">
            <h2>Adventure Diary</h2>
            <ul>
              {diaryEntries.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.title}</strong>
                  <p>{entry.content}</p>
                </li>
              ))}
            </ul>
          </article>
        </section>
      ) : (
        <section className="grid">
          <article className="card wide">
            <h2>Manage Map Events</h2>
            <p>Click the map to position the new marker.</p>
            <MapView events={events} onMapClick={(coords) => setEventDraft((old) => ({ ...old, ...coords }))} />
            <form onSubmit={submitEvent} className="form">
              <input
                value={eventDraft.title}
                onChange={(event) => setEventDraft((old) => ({ ...old, title: event.target.value }))}
                placeholder="Event title"
                required
              />
              <input
                value={eventDraft.description}
                onChange={(event) => setEventDraft((old) => ({ ...old, description: event.target.value }))}
                placeholder="Description"
              />
              <select value={eventDraft.event_type} onChange={(event) => setEventDraft((old) => ({ ...old, event_type: event.target.value }))}>
                <option value="event">Event</option>
                <option value="quest">Quest</option>
              </select>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={eventDraft.latitude}
                onChange={(event) => setEventDraft((old) => ({ ...old, latitude: Number(event.target.value) }))}
                required
              />
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={eventDraft.longitude}
                onChange={(event) => setEventDraft((old) => ({ ...old, longitude: Number(event.target.value) }))}
                required
              />
              <button type="submit">Add marker</button>
            </form>
            <ul>
              {events.map((event) => (
                <li key={event.id} className="row">
                  <span>
                    {event.title} ({event.event_type}) at [{event.latitude}, {event.longitude}]
                  </span>
                  <button type="button" onClick={() => deleteEvent(event.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </article>

          <article className="card">
            <h2>Manage Resources</h2>
            <form onSubmit={submitResource} className="form">
              <input
                value={resourceDraft.name}
                onChange={(event) => setResourceDraft((old) => ({ ...old, name: event.target.value }))}
                placeholder="Name"
                required
              />
              <input
                type="number"
                min="0"
                value={resourceDraft.quantity}
                onChange={(event) => setResourceDraft((old) => ({ ...old, quantity: event.target.value }))}
                placeholder="Quantity"
                required
              />
              <input
                value={resourceDraft.notes}
                onChange={(event) => setResourceDraft((old) => ({ ...old, notes: event.target.value }))}
                placeholder="Notes"
              />
              <button type="submit">Add resource</button>
            </form>
          </article>

          <article className="card">
            <h2>Manage Diary</h2>
            <form onSubmit={submitDiary} className="form">
              <input
                value={diaryDraft.title}
                onChange={(event) => setDiaryDraft((old) => ({ ...old, title: event.target.value }))}
                placeholder="Entry title"
                required
              />
              <textarea
                value={diaryDraft.content}
                onChange={(event) => setDiaryDraft((old) => ({ ...old, content: event.target.value }))}
                placeholder="What happened this session?"
                rows={4}
                required
              />
              <button type="submit">Add entry</button>
            </form>
          </article>
        </section>
      )}
    </main>
  );
}

export default App;
