import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// ===== AUTH HELPERS =====
function getAuthToken() {
  return localStorage.getItem("authToken");
}

function setAuthToken(token) {
  localStorage.setItem("authToken", token);
}

function clearAuthToken() {
  localStorage.removeItem("authToken");
  localStorage.removeItem("isAdmin");
}

function getIsAdmin() {
  return localStorage.getItem("isAdmin") === "true";
}

function setIsAdmin(isAdmin) {
  localStorage.setItem("isAdmin", isAdmin ? "true" : "false");
}

// ===== HOOKS =====
function useApiData(path, defaultValue) {
  const [data, setData] = useState(defaultValue);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}${path}`);
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      setData(payload);
    } catch (error) {
      console.error(error);
    }
  }, [path]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return [data, refresh];
}

function useAuthenticatedApiData(path, defaultValue, isAuthenticated) {
  const [data, setData] = useState(defaultValue);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setData(defaultValue);
      return;
    }
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      setData(payload);
    } catch (error) {
      console.error(error);
    }
  }, [path, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return [data, refresh];
}

// ===== MAP COMPONENT =====
function MapView({ events, onMapClick, readonly = false, mapImageUrl = null, tempMarker = null }) {
  const containerRef = useRef(null);
  const innerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [activePopup, setActivePopup] = useState(null); // { event, screenX, screenY }
  const dragRef = useRef(null);
  const didDragRef = useRef(false);
  const popupTimerRef = useRef(null);

  const markers = useMemo(() => {
    return events.map((event) => ({
      ...event,
      top: `${event.latitude}%`,
      left: `${event.longitude}%`,
    }));
  }, [events]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    // Normalize delta across browsers/mice
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY;
    const factor = delta < 0 ? 1.12 : 1 / 1.12;
    const bounds = containerRef.current.getBoundingClientRect();
    const cx = e.clientX - bounds.left;
    const cy = e.clientY - bounds.top;
    setZoom((prevZoom) => {
      const newZoom = Math.min(Math.max(prevZoom * factor, 0.5), 8);
      setPan((prevPan) => ({
        x: cx - (cx - prevPan.x) * (newZoom / prevZoom),
        y: cy - (cy - prevPan.y) * (newZoom / prevZoom),
      }));
      return newZoom;
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y };
    didDragRef.current = false;
    setIsDragging(true);
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true;
    setPan({ x: dragRef.current.startPanX + dx, y: dragRef.current.startPanY + dy });
  };

  const handleMouseUp = () => {
    dragRef.current = null;
    setIsDragging(false);
  };

  const handleClick = (e) => {
    if (readonly || !onMapClick || didDragRef.current) return;
    if (!innerRef.current) return;
    const innerBounds = innerRef.current.getBoundingClientRect();
    const latitude = ((e.clientY - innerBounds.top) / innerBounds.height) * 100;
    const longitude = ((e.clientX - innerBounds.left) / innerBounds.width) * 100;
    if (latitude < 0 || latitude > 100 || longitude < 0 || longitude > 100) return;
    setActivePopup(null);
    onMapClick({ latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)) });
  };

  const openPopup = (e, event) => {
    clearTimeout(popupTimerRef.current);
    const b = e.currentTarget.getBoundingClientRect();
    setActivePopup({ event, screenX: b.left + b.width / 2, screenY: b.top });
  };

  const scheduleClosePopup = () => {
    popupTimerRef.current = setTimeout(() => setActivePopup(null), 120);
  };

  const handleMarkerClick = (e, event) => {
    e.stopPropagation();
    if (didDragRef.current) return;
    const b = e.currentTarget.getBoundingClientRect();
    setActivePopup((prev) =>
      prev?.event.id === event.id ? null : { event, screenX: b.left + b.width / 2, screenY: b.top }
    );
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const cursorStyle = isDragging ? "grabbing" : readonly ? "grab" : "crosshair";

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        className="map-wrapper"
        style={{ cursor: cursorStyle, userSelect: "none", touchAction: "none" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      >
        <div
          ref={innerRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            width: "100%",
            position: "relative",
          }}
        >
          <img
            src={mapImageUrl || "/map-placeholder.svg"}
            alt="Campaign map"
            className="map-image"
            draggable={false}
          />
          {tempMarker && (
            <div
              className="marker marker-temp"
              style={{ top: `${tempMarker.latitude}%`, left: `${tempMarker.longitude}%` }}
            />
          )}
          {markers.map((event) => (
            <button
              type="button"
              key={event.id}
              className={`marker marker-${event.event_type || event.poi_type}${activePopup?.event.id === event.id ? " marker-active" : ""}`}
              style={{ top: event.top, left: event.left }}
              title={event.title}
              onMouseEnter={(e) => openPopup(e, event)}
              onMouseLeave={scheduleClosePopup}
              onClick={(e) => handleMarkerClick(e, event)}
            />
          ))}
        </div>
      </div>
      {activePopup && (
        <div
          className="marker-popup"
          style={{ left: activePopup.screenX, top: activePopup.screenY }}
          onMouseEnter={() => clearTimeout(popupTimerRef.current)}
          onMouseLeave={scheduleClosePopup}
          onClick={(e) => e.stopPropagation()}
        >
          <strong>{activePopup.event.title}</strong>
          <span className="marker-popup-type">{activePopup.event.event_type || activePopup.event.poi_type}</span>
          {activePopup.event.description && <p>{activePopup.event.description}</p>}
          {activePopup.event.image_path && (
            <img
              src={`${API_URL}/${activePopup.event.image_path}`}
              alt={activePopup.event.title}
              className="marker-popup-image"
            />
          )}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "0.5rem" }}>
        <small style={{ color: "#5d3a1a" }}>🔵 Events • 🟠 Quests • 🟢 Locations • 🟡 Cities • 🟣 Dungeons • 🔷 Landmarks</small>
        <button type="button" onClick={resetView} style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}>⟳ Reset View</button>
      </div>
    </div>
  );
}

// ===== MAIN APP =====
function App() {
  // History API routing — map pathname to view name
  const parsePath = () => {
    const p = window.location.pathname.replace(/^\//, "") || "tracker";
    return p === "" ? "tracker" : p;
  };

  const [activeView, setActiveView] = useState(parsePath);

  useEffect(() => {
    const handlePop = () => setActiveView(parsePath());
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const navigate = (view) => {
    const path = view === "tracker" ? "/" : `/${view}`;
    history.pushState({}, "", path);
    setActiveView(view);
  };

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(!!getAuthToken());
  const [isAdmin, setIsAdminState] = useState(getIsAdmin());
  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [registerData, setRegisterData] = useState({ username: "", password: "", confirmPassword: "" });
  const [loginError, setLoginError] = useState("");
  const [registerError, setRegisterError] = useState("");

  // Campaign/Public data
  const [events, refreshEvents] = useApiData("/events", []);
  const [resources, refreshResources] = useApiData("/resources", []);
  const [diaryEntries, refreshDiaryEntries] = useApiData("/diary", []);
  const [creatures, refreshCreatures] = useApiData("/creatures", []);
  const [allies, refreshAllies] = useApiData("/allies", []);
  const [maps, refreshMaps] = useApiData("/maps", []);
  const [organizations, refreshOrganizations] = useApiData("/organizations", []);
  const [orgDraft, setOrgDraft] = useState({ name: "", description: "" });
  const [orgImageFile, setOrgImageFile] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [selectedOrgImage, setSelectedOrgImage] = useState(null);
  const [orgError, setOrgError] = useState("");

  // Map state
  const [selectedMap, setSelectedMap] = useState(null);       // admin: manage POIs
  const [selectedMapPOIs, setSelectedMapPOIs] = useState([]); // admin: POIs for selected map
  const [trackerMap, setTrackerMap] = useState(null);         // tracker view
  const [trackerMapPOIs, setTrackerMapPOIs] = useState([]);   // tracker view
  const [adminEventMap, setAdminEventMap] = useState(null);   // admin: map for event management
  const [adminMapEvents, setAdminMapEvents] = useState([]);   // admin: events for selected map

  // POI draft (pending placement)
  const [poiDraft, setPoiDraft] = useState(null); // { latitude, longitude } or null
  const [poiDraftData, setPoiDraftData] = useState({ title: "", description: "", poi_type: "location" });
  const [poiImageFile, setPoiImageFile] = useState(null);

  // Tracker view: unified marker placement for authenticated users
  const [trackerMarkerDraft, setTrackerMarkerDraft] = useState(null); // { latitude, longitude }
  const [trackerMarkerForm, setTrackerMarkerForm] = useState({ title: "", description: "", kind: "poi", poi_type: "location", event_type: "event" });
  const [trackerMarkerImageFile, setTrackerMarkerImageFile] = useState(null);
  const [editingPoi, setEditingPoi] = useState(null); // { id, title, description, poi_type }
  const [editingPoiImageFile, setEditingPoiImageFile] = useState(null);

  const [editingEvent, setEditingEvent] = useState(null); // { id, title, description, event_type, latitude, longitude, map_id }
  const [editingEventImageFile, setEditingEventImageFile] = useState(null);

  // Admin: users list
  const [users, setUsers] = useState([]);

  // User-specific data
  const [characters, refreshCharacters] = useAuthenticatedApiData("/characters", [], isAuthenticated);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [characterInventory, setCharacterInventory] = useState([]);
  const [characterDiary, setCharacterDiary] = useState([]);

  // Form drafts
  const [eventDraft, setEventDraft] = useState({ title: "", description: "", event_type: "event", latitude: 50, longitude: 50, map_id: null });
  const [resourceDraft, setResourceDraft] = useState({ name: "", quantity: 0, notes: "" });
  const [resourceImageFile, setResourceImageFile] = useState(null);
  const [selectedResourceImage, setSelectedResourceImage] = useState(null); // URL string for lightbox
  const [diaryDraft, setDiaryDraft] = useState({ title: "", content: "" });
  const [diaryImageFile, setDiaryImageFile] = useState(null);
  const [selectedDiaryImage, setSelectedDiaryImage] = useState(null);
  const [characterDraft, setCharacterDraft] = useState({ name: "", character_class: "", level: 1, race: "", notes: "", organization_id: null });
  const [characterImageFile, setCharacterImageFile] = useState(null);
  const [selectedCharacterImage, setSelectedCharacterImage] = useState(null);
  const [creatureDraft, setCreatureDraft] = useState({ name: "", creature_type: "", challenge_rating: "", armor_class: 0, hit_points: "", speed: "", abilities: "", weaknesses: "", resistances: "", immunities: "", notes: "" });
  const [creatureImageFile, setCreatureImageFile] = useState(null);
  const [selectedCreatureImage, setSelectedCreatureImage] = useState(null);
  const [allyDraft, setAllyDraft] = useState({ name: "", role: "", location: "", relationship: "", notes: "", organization_id: null });
  const [allyImageFile, setAllyImageFile] = useState(null);
  const [selectedAllyImage, setSelectedAllyImage] = useState(null);
  const [inventoryDraft, setInventoryDraft] = useState({ item_name: "", quantity: 1, description: "" });
  const [charDiaryDraft, setCharDiaryDraft] = useState({ title: "", content: "" });

  // Error states
  const [eventError, setEventError] = useState("");
  const [resourceError, setResourceError] = useState("");
  const [diaryError, setDiaryError] = useState("");
  const [characterError, setCharacterError] = useState("");
  const [creatureError, setCreatureError] = useState("");
  const [allyError, setAllyError] = useState("");

  // Helper: read error messages
  const readErrorMessage = async (response, fallbackText) => {
    try {
      const payload = await response.json();
      return payload.detail ?? fallbackText;
    } catch {
      return fallbackText;
    }
  };

  // Helper: fetch user info
  const fetchUserInfo = async (token) => {
    try {
      const response = await fetch(`${API_URL}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const userData = await response.json();
        setIsAdmin(userData.is_admin);
        setIsAdminState(userData.is_admin);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // Auth: Login
  const login = async (event) => {
    event.preventDefault();
    setLoginError("");
    const formData = new URLSearchParams();
    formData.append("username", loginData.username);
    formData.append("password", loginData.password);

    const response = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    if (response.ok) {
      const data = await response.json();
      setAuthToken(data.access_token);
      const userInfoFetched = await fetchUserInfo(data.access_token);
      if (userInfoFetched) {
        setIsAuthenticated(true);
        setLoginData({ username: "", password: "" });
        navigate("tracker");
      } else {
        setLoginError("Failed to fetch user information");
        clearAuthToken();
      }
      return;
    }
    setLoginError(await readErrorMessage(response, "Login failed"));
  };

  // Auth: Register
  const register = async (event) => {
    event.preventDefault();
    setRegisterError("");

    if (registerData.password !== registerData.confirmPassword) {
      setRegisterError("Passwords do not match");
      return;
    }

    if (registerData.password.length < 8) {
      setRegisterError("Password must be at least 8 characters");
      return;
    }

    const response = await fetch(`${API_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: registerData.username, password: registerData.password }),
    });

    if (response.ok) {
      setRegisterError("");
      setRegisterData({ username: "", password: "", confirmPassword: "" });
      setLoginData({ username: registerData.username, password: "" });
      navigate("login");
      return;
    }
    setRegisterError(await readErrorMessage(response, "Registration failed"));
  };

  // Auth: Logout
  const logout = () => {
    clearAuthToken();
    setIsAuthenticated(false);
    setIsAdminState(false);
    setSelectedCharacter(null);
    navigate("tracker");
  };

  // Campaign: Submit Event
  const submitEvent = async (event) => {
    event.preventDefault();
    const token = getAuthToken();
    const response = await fetch(`${API_URL}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(eventDraft),
    });
    if (response.ok) {
      setEventError("");
      setEventDraft({ title: "", description: "", event_type: "event", latitude: 50, longitude: 50, map_id: adminEventMap?.id ?? null });
      refreshEvents();
      if (adminEventMap) loadAdminMapEvents(adminEventMap.id);
      return;
    }
    if (response.status === 401 || response.status === 403) {
      logout();
      setEventError("Session expired. Please login again.");
      return;
    }
    setEventError(await readErrorMessage(response, "Could not create event."));
  };

  // Admin: Load events for a specific map
  const loadAdminMapEvents = async (mapId) => {
    try {
      const response = await fetch(`${API_URL}/events?map_id=${mapId}`);
      if (response.ok) setAdminMapEvents(await response.json());
    } catch (error) {
      console.error(error);
    }
  };

  // Campaign: Delete Event
  const deleteEvent = async (id) => {
    const token = getAuthToken();
    await fetch(`${API_URL}/events/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    refreshEvents();
    if (adminEventMap) loadAdminMapEvents(adminEventMap.id);
  };

  // Resources: Submit Resource
  const submitResource = async (event) => {
    event.preventDefault();
    const token = getAuthToken();
    const response = await fetch(`${API_URL}/resources`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...resourceDraft, quantity: Number(resourceDraft.quantity) }),
    });
    if (response.ok) {
      const created = await response.json();
      if (resourceImageFile) {
        const fd = new FormData();
        fd.append("file", resourceImageFile);
        await fetch(`${API_URL}/resources/${created.id}/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        setResourceImageFile(null);
      }
      setResourceError("");
      setResourceDraft({ name: "", quantity: 0, notes: "" });
      refreshResources();
      return;
    }
    if (response.status === 401 || response.status === 403) {
      logout();
      setResourceError("Session expired. Please login again.");
      return;
    }
    setResourceError(await readErrorMessage(response, "Could not create resource."));
  };

  // Diary: Submit Diary Entry
  const submitDiary = async (event) => {
    event.preventDefault();
    const token = getAuthToken();
    const response = await fetch(`${API_URL}/diary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(diaryDraft),
    });
    if (response.ok) {
      const created = await response.json();
      if (diaryImageFile) {
        const fd = new FormData();
        fd.append("file", diaryImageFile);
        await fetch(`${API_URL}/diary/${created.id}/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        setDiaryImageFile(null);
      }
      setDiaryError("");
      setDiaryDraft({ title: "", content: "" });
      refreshDiaryEntries();
      return;
    }
    if (response.status === 401 || response.status === 403) {
      logout();
      setDiaryError("Session expired. Please login again.");
      return;
    }
    setDiaryError(await readErrorMessage(response, "Could not create diary entry."));
  };

  // Characters: Submit Character
  const submitCharacter = async (event) => {
    event.preventDefault();
    const token = getAuthToken();
    const response = await fetch(`${API_URL}/characters`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(characterDraft),
    });
    if (response.ok) {
      const created = await response.json();
      if (characterImageFile) {
        const fd = new FormData();
        fd.append("file", characterImageFile);
        await fetch(`${API_URL}/characters/${created.id}/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        setCharacterImageFile(null);
      }
      setCharacterError("");
      setCharacterDraft({ name: "", character_class: "", level: 1, race: "", notes: "", organization_id: null });
      refreshCharacters();
      return;
    }
    setCharacterError(await readErrorMessage(response, "Could not create character."));
  };

  const uploadCharacterImage = async (characterId, file) => {
    const token = getAuthToken();
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`${API_URL}/characters/${characterId}/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    refreshCharacters();
    // update selectedCharacter if viewing it
    setSelectedCharacter((prev) => prev?.id === characterId ? { ...prev, image_path: URL.createObjectURL(file) } : prev);
  };

  // Characters: Upload Sheet
  const uploadCharacterSheet = async (characterId, file) => {
    const token = getAuthToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_URL}/characters/${characterId}/upload-sheet`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (response.ok) {
      refreshCharacters();
      alert("Character sheet uploaded!");
    } else {
      alert("Failed to upload character sheet");
    }
  };

  // Characters: Delete Character
  const deleteCharacter = async (id) => {
    if (!confirm("Delete this character?")) return;
    const token = getAuthToken();
    await fetch(`${API_URL}/characters/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    refreshCharacters();
    if (selectedCharacter?.id === id) {
      setSelectedCharacter(null);
    }
  };

  // Characters: Load Character Details
  const loadCharacterDetails = async (character) => {
    setSelectedCharacter(character);
    const token = getAuthToken();

    // Load inventory
    const invResponse = await fetch(`${API_URL}/characters/${character.id}/inventory`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (invResponse.ok) {
      setCharacterInventory(await invResponse.json());
    }

    // Load diary
    const diaryResponse = await fetch(`${API_URL}/characters/${character.id}/diary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (diaryResponse.ok) {
      setCharacterDiary(await diaryResponse.json());
    }
  };

  // Character Inventory: Add Item
  const addInventoryItem = async (event) => {
    event.preventDefault();
    if (!selectedCharacter) return;

    const token = getAuthToken();
    const response = await fetch(`${API_URL}/characters/${selectedCharacter.id}/inventory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...inventoryDraft, character_id: selectedCharacter.id }),
    });

    if (response.ok) {
      setInventoryDraft({ item_name: "", quantity: 1, description: "" });
      loadCharacterDetails(selectedCharacter);
    }
  };

  // Character Inventory: Delete Item
  const deleteInventoryItem = async (itemId) => {
    const token = getAuthToken();
    await fetch(`${API_URL}/inventory/${itemId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    loadCharacterDetails(selectedCharacter);
  };

  // Character Diary: Add Entry
  const addCharacterDiaryEntry = async (event) => {
    event.preventDefault();
    if (!selectedCharacter) return;

    const token = getAuthToken();
    const response = await fetch(`${API_URL}/characters/${selectedCharacter.id}/diary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...charDiaryDraft, character_id: selectedCharacter.id }),
    });

    if (response.ok) {
      setCharDiaryDraft({ title: "", content: "" });
      loadCharacterDetails(selectedCharacter);
    }
  };

  // Bestiary: Submit Creature
  const submitCreature = async (event) => {
    event.preventDefault();
    const token = getAuthToken();
    const response = await fetch(`${API_URL}/creatures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(creatureDraft),
    });
    if (response.ok) {
      const created = await response.json();
      if (creatureImageFile) {
        const fd = new FormData();
        fd.append("file", creatureImageFile);
        await fetch(`${API_URL}/creatures/${created.id}/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        setCreatureImageFile(null);
      }
      setCreatureError("");
      setCreatureDraft({ name: "", creature_type: "", challenge_rating: "", armor_class: 0, hit_points: "", speed: "", abilities: "", weaknesses: "", resistances: "", immunities: "", notes: "" });
      refreshCreatures();
      return;
    }
    setCreatureError(await readErrorMessage(response, "Could not add creature."));
  };

  // Bestiary: Delete Creature
  const deleteCreature = async (id) => {
    const token = getAuthToken();
    await fetch(`${API_URL}/creatures/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    refreshCreatures();
  };

  // Allies: Submit Ally
  const submitAlly = async (event) => {
    event.preventDefault();
    const token = getAuthToken();
    const response = await fetch(`${API_URL}/allies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(allyDraft),
    });
    if (response.ok) {
      const created = await response.json();
      if (allyImageFile) {
        const fd = new FormData();
        fd.append("file", allyImageFile);
        await fetch(`${API_URL}/allies/${created.id}/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        setAllyImageFile(null);
      }
      setAllyError("");
      setAllyDraft({ name: "", role: "", location: "", relationship: "", notes: "", organization_id: null });
      refreshAllies();
      return;
    }
    setAllyError(await readErrorMessage(response, "Could not add ally."));
  };

  // Allies: Delete Ally
  const deleteAlly = async (id) => {
    const token = getAuthToken();
    await fetch(`${API_URL}/allies/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    refreshAllies();
  };

  const uploadAllyImage = async (allyId, file) => {
    const token = getAuthToken();
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`${API_URL}/allies/${allyId}/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    refreshAllies();
  };

  const setAllyAlignment = async (allyId, alignment) => {
    const token = getAuthToken();
    await fetch(`${API_URL}/allies/${allyId}/alignment?alignment=${alignment}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
    refreshAllies();
  };

  const uploadCreatureImage = async (creatureId, file) => {
    const token = getAuthToken();
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`${API_URL}/creatures/${creatureId}/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    refreshCreatures();
  };

  const uploadDiaryImage = async (entryId, file) => {
    const token = getAuthToken();
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`${API_URL}/diary/${entryId}/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    refreshDiaryEntries();
  };

  const submitOrganization = async (e) => {
    e.preventDefault();
    const token = getAuthToken();
    const res = await fetch(`${API_URL}/organizations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(orgDraft),
    });
    if (res.ok) {
      const created = await res.json();
      if (orgImageFile) {
        const fd = new FormData();
        fd.append("file", orgImageFile);
        await fetch(`${API_URL}/organizations/${created.id}/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        setOrgImageFile(null);
      }
      setOrgDraft({ name: "", description: "" });
      setOrgError("");
      refreshOrganizations();
    } else {
      setOrgError(await readErrorMessage(res, "Could not create organization."));
    }
  };

  const deleteOrganization = async (id) => {
    const token = getAuthToken();
    await fetch(`${API_URL}/organizations/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (selectedOrg?.id === id) setSelectedOrg(null);
    refreshOrganizations();
  };

  const uploadOrganizationImage = async (orgId, file) => {
    const token = getAuthToken();
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`${API_URL}/organizations/${orgId}/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    refreshOrganizations();
  };

  // Maps: Upload Map
  const uploadMap = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const token = getAuthToken();

    const response = await fetch(`${API_URL}/maps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (response.ok) {
      event.target.reset();
      refreshMaps();
      alert("Map uploaded successfully!");
    } else {
      alert("Failed to upload map");
    }
  };

  // Maps: Delete Map
  const deleteMap = async (id) => {
    if (!confirm("Delete this map?")) return;
    const token = getAuthToken();
    await fetch(`${API_URL}/maps/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    refreshMaps();
    if (selectedMap?.id === id) {
      setSelectedMap(null);
      setSelectedMapPOIs([]);
    }
  };

  // Maps: Load POIs for a map (admin panel)
  const loadMapPOIs = async (mapId) => {
    try {
      const response = await fetch(`${API_URL}/maps/${mapId}/pois`);
      if (response.ok) {
        setSelectedMapPOIs(await response.json());
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Maps: Load POIs for tracker view
  const loadTrackerMapPOIs = async (mapId) => {
    try {
      const response = await fetch(`${API_URL}/maps/${mapId}/pois`);
      if (response.ok) {
        setTrackerMapPOIs(await response.json());
      }
    } catch (error) {
      console.error(error);
    }
  };

  // Auto-select first map in tracker when maps load
  useEffect(() => {
    if (maps.length > 0 && !trackerMap) {
      setTrackerMap(maps[0]);
      loadTrackerMapPOIs(maps[0].id);
    }
  }, [maps]);

  // Maps: Add POI (set draft position on map click)
  const addPOI = (coords) => {
    if (!selectedMap) return;
    setPoiDraft(coords);
    setPoiDraftData({ title: "", description: "", poi_type: "location" });
    setPoiImageFile(null);
  };

  const submitPOI = async (e) => {
    e.preventDefault();
    if (!selectedMap || !poiDraft) return;
    const token = getAuthToken();
    const response = await fetch(`${API_URL}/pois`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        map_id: selectedMap.id,
        title: poiDraftData.title,
        description: poiDraftData.description,
        poi_type: poiDraftData.poi_type,
        latitude: poiDraft.latitude,
        longitude: poiDraft.longitude,
      }),
    });
    if (response.ok) {
      const newPoi = await response.json();
      if (poiImageFile) {
        await uploadMarkerImage("pois", newPoi.id, poiImageFile);
      }
      setPoiDraft(null);
      loadMapPOIs(selectedMap.id);
    }
  };

  const uploadMarkerImage = async (type, id, file) => {
    const token = getAuthToken();
    const formData = new FormData();
    formData.append("file", file);
    await fetch(`${API_URL}/${type}/${id}/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
  };

  const uploadPOIImage = async (poiId, file) => {
    await uploadMarkerImage("pois", poiId, file);
    if (selectedMap) loadMapPOIs(selectedMap.id);
  };

  const uploadEventImage = async (eventId, file) => {
    await uploadMarkerImage("events", eventId, file);
    if (adminEventMap) loadAdminMapEvents(adminEventMap.id);
  };

  // Tracker: submit unified marker (POI or event)
  const submitTrackerMarker = async (e) => {
    e.preventDefault();
    if (!trackerMarkerDraft || !trackerMap) return;
    const token = getAuthToken();
    const { title, description, kind, poi_type, event_type } = trackerMarkerForm;

    let newId = null;
    if (kind === "poi") {
      const res = await fetch(`${API_URL}/pois`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ map_id: trackerMap.id, title, description, poi_type, latitude: trackerMarkerDraft.latitude, longitude: trackerMarkerDraft.longitude }),
      });
      if (res.ok) { const d = await res.json(); newId = d.id; loadTrackerMapPOIs(trackerMap.id); }
    } else {
      const res = await fetch(`${API_URL}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ map_id: trackerMap.id, title, description, event_type, latitude: trackerMarkerDraft.latitude, longitude: trackerMarkerDraft.longitude }),
      });
      if (res.ok) { const d = await res.json(); newId = d.id; refreshEvents(); }
    }

    if (newId && trackerMarkerImageFile) {
      const type = kind === "poi" ? "pois" : "events";
      await uploadMarkerImage(type, newId, trackerMarkerImageFile);
      if (kind === "poi") loadTrackerMapPOIs(trackerMap.id);
      else refreshEvents();
    }

    setTrackerMarkerDraft(null);
    setTrackerMarkerForm({ title: "", description: "", kind: "poi", poi_type: "location", event_type: "event" });
    setTrackerMarkerImageFile(null);
  };

  // Tracker: delete a POI from the tracker view
  const deleteTrackerPOI = async (poiId) => {
    const token = getAuthToken();
    await fetch(`${API_URL}/pois/${poiId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (trackerMap) loadTrackerMapPOIs(trackerMap.id);
  };

  const updatePOI = async (e) => {
    e.preventDefault();
    if (!editingPoi) return;
    const token = getAuthToken();
    const { id, title, description, poi_type } = editingPoi;
    const res = await fetch(`${API_URL}/pois/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title, description, poi_type }),
    });
    if (res.ok) {
      if (editingPoiImageFile) {
        await uploadPOIImage(id, editingPoiImageFile);
        setEditingPoiImageFile(null);
      }
      setEditingPoi(null);
      if (trackerMap) loadTrackerMapPOIs(trackerMap.id);
      if (selectedMap) loadMapPOIs(selectedMap.id);
    }
  };

  const updateEvent = async (e) => {
    e.preventDefault();
    if (!editingEvent) return;
    const token = getAuthToken();
    const { id, title, description, event_type, latitude, longitude, map_id } = editingEvent;
    const res = await fetch(`${API_URL}/events/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title, description, event_type, latitude, longitude, map_id }),
    });
    if (res.ok) {
      if (editingEventImageFile) {
        await uploadEventImage(id, editingEventImageFile);
        setEditingEventImageFile(null);
      }
      setEditingEvent(null);
      refreshEvents();
    }
  };

  // Diary: delete entry
  const deleteDiaryEntry = async (id) => {
    const token = getAuthToken();
    await fetch(`${API_URL}/diary/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    refreshDiaryEntries();
  };

  // Resources: delete resource
  const deleteResource = async (id) => {
    const token = getAuthToken();
    await fetch(`${API_URL}/resources/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    refreshResources();
  };

  const uploadResourceImage = async (resourceId, file) => {
    const token = getAuthToken();
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`${API_URL}/resources/${resourceId}/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    refreshResources();
  };

  // Maps: Delete POI
  const deletePOI = async (poiId) => {
    const token = getAuthToken();
    await fetch(`${API_URL}/pois/${poiId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (selectedMap) {
      loadMapPOIs(selectedMap.id);
    }
  };

  // Users: Load all users (admin only)
  const loadUsers = async () => {
    const token = getAuthToken();
    const response = await fetch(`${API_URL}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      setUsers(await response.json());
    }
  };

  // Users: Toggle admin
  const toggleAdmin = async (userId, currentlyAdmin) => {
    const token = getAuthToken();
    const endpoint = currentlyAdmin ? "remove-admin" : "make-admin";
    const response = await fetch(`${API_URL}/users/${userId}/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      loadUsers();
    }
  };

  return (
    <main>
      <header>
        <h1>⚔️ Campaign Chronicle</h1>
        <div className="tabs">
          <button type="button" onClick={() => navigate("tracker")} className={activeView === "tracker" ? "active" : ""}>
            📜 Chronicle
          </button>
          {isAuthenticated && (
            <>
              <button type="button" onClick={() => navigate("characters")} className={activeView === "characters" ? "active" : ""}>
                🗡️ Characters
              </button>
              <button type="button" onClick={() => navigate("bestiary")} className={activeView === "bestiary" ? "active" : ""}>
                🐉 Bestiary
              </button>
              <button type="button" onClick={() => navigate("organizations")} className={activeView === "organizations" ? "active" : ""}>🏰 Organizations</button>
              <button type="button" onClick={() => navigate("npcs")} className={activeView === "npcs" ? "active" : ""}>
                👤 NPCs
              </button>
            </>
          )}
          {!isAuthenticated && (
            <>
              <button type="button" onClick={() => navigate("bestiary")} className={activeView === "bestiary" ? "active" : ""}>
                🐉 Bestiary
              </button>
              <button type="button" onClick={() => navigate("organizations")} className={activeView === "organizations" ? "active" : ""}>🏰 Organizations</button>
              <button type="button" onClick={() => navigate("npcs")} className={activeView === "npcs" ? "active" : ""}>
                👤 NPCs
              </button>
              <button type="button" onClick={() => navigate("login")} className={activeView === "login" ? "active" : ""}>
                🔓 Login
              </button>
              <button type="button" onClick={() => navigate("register")} className={activeView === "register" ? "active" : ""}>
                📝 Register
              </button>
            </>
          )}
          {isAuthenticated && (
            <button type="button" onClick={logout}>
              🚪 Logout
            </button>
          )}
        </div>
      </header>

      {/* LOGIN VIEW */}
      {activeView === "login" && !isAuthenticated ? (
        <section className="grid">
          <article className="card">
            <h2>Login</h2>
            <form onSubmit={login} className="form">
              <input
                value={loginData.username}
                onChange={(event) => setLoginData((old) => ({ ...old, username: event.target.value }))}
                placeholder="Username"
                required
              />
              <input
                type="password"
                value={loginData.password}
                onChange={(event) => setLoginData((old) => ({ ...old, password: event.target.value }))}
                placeholder="Password"
                required
              />
              <button type="submit">Login</button>
            </form>
            {loginError ? <p className="error">{loginError}</p> : null}
            <p>
              <small>
                Don't have an account?{" "}
                <button type="button" onClick={() => navigate("register")} style={{ background: "none", border: "none", color: "#8b4513", textDecoration: "underline", cursor: "pointer" }}>
                  Register here
                </button>
              </small>
            </p>
          </article>
        </section>
      ) : null}

      {/* REGISTER VIEW */}
      {activeView === "register" && !isAuthenticated ? (
        <section className="grid">
          <article className="card">
            <h2>Register</h2>
            <form onSubmit={register} className="form">
              <input
                value={registerData.username}
                onChange={(event) => setRegisterData((old) => ({ ...old, username: event.target.value }))}
                placeholder="Username (min 3 characters)"
                minLength={3}
                required
              />
              <input
                type="password"
                value={registerData.password}
                onChange={(event) => setRegisterData((old) => ({ ...old, password: event.target.value }))}
                placeholder="Password (min 8 characters)"
                minLength={8}
                required
              />
              <input
                type="password"
                value={registerData.confirmPassword}
                onChange={(event) => setRegisterData((old) => ({ ...old, confirmPassword: event.target.value }))}
                placeholder="Confirm Password"
                required
              />
              <button type="submit">Register</button>
            </form>
            {registerError ? <p className="error">{registerError}</p> : null}
            <p>
              <small>
                Already have an account?{" "}
                <button type="button" onClick={() => navigate("login")} style={{ background: "none", border: "none", color: "#8b4513", textDecoration: "underline", cursor: "pointer" }}>
                  Login here
                </button>
              </small>
            </p>
          </article>
        </section>
      ) : null}

      {/* TRACKER VIEW */}
      {activeView === "tracker" ? (
        <section className="grid">
          <article className="card wide">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0 }}>
                {trackerMap ? trackerMap.name : "World Map"}
              </h2>
              {maps.length > 1 && (
                <select
                  value={trackerMap?.id ?? ""}
                  onChange={(e) => {
                    const map = maps.find((m) => m.id === Number(e.target.value));
                    if (map) {
                      setTrackerMap(map);
                      loadTrackerMapPOIs(map.id);
                    }
                  }}
                >
                  {maps.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
            </div>
            {isAuthenticated && <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", color: "#5d3a1a" }}>Click the map to place a marker.</p>}
            <MapView
              events={[...events.filter((e) => e.map_id === (trackerMap?.id ?? null)), ...trackerMapPOIs]}
              onMapClick={isAuthenticated ? (coords) => { setTrackerMarkerDraft(coords); setTrackerMarkerForm({ title: "", description: "", kind: "poi", poi_type: "location", event_type: "event" }); } : undefined}
              mapImageUrl={trackerMap ? `${API_URL}/${trackerMap.file_path}` : null}
              tempMarker={trackerMarkerDraft}
            />

            {isAuthenticated && trackerMarkerDraft && (
              <form onSubmit={submitTrackerMarker} className="form" style={{ marginTop: "1rem", padding: "1rem", background: "#f9f0e0", border: "2px solid #8b4513", borderRadius: "4px" }}>
                <p style={{ margin: 0 }}><strong>📌 New Marker</strong> at {trackerMarkerDraft.latitude.toFixed(1)}%, {trackerMarkerDraft.longitude.toFixed(1)}%</p>
                <input
                  value={trackerMarkerForm.title}
                  onChange={(e) => setTrackerMarkerForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Title"
                  required
                />
                <input
                  value={trackerMarkerForm.description}
                  onChange={(e) => setTrackerMarkerForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Description (optional)"
                />
                <select value={trackerMarkerForm.kind} onChange={(e) => setTrackerMarkerForm((f) => ({ ...f, kind: e.target.value }))}>
                  <option value="poi">Point of Interest</option>
                  <option value="event">Event Marker</option>
                </select>
                {trackerMarkerForm.kind === "poi" ? (
                  <select value={trackerMarkerForm.poi_type} onChange={(e) => setTrackerMarkerForm((f) => ({ ...f, poi_type: e.target.value }))}>
                    <option value="location">Location</option>
                    <option value="city">City</option>
                    <option value="dungeon">Dungeon</option>
                    <option value="landmark">Landmark</option>
                    <option value="quest">Quest</option>
                  </select>
                ) : (
                  <select value={trackerMarkerForm.event_type} onChange={(e) => setTrackerMarkerForm((f) => ({ ...f, event_type: e.target.value }))}>
                    <option value="event">Event</option>
                    <option value="quest">Quest</option>
                  </select>
                )}
                <label style={{ fontSize: "0.9rem" }}>Image (optional):
                  <input type="file" accept="image/*" style={{ marginLeft: "0.5rem" }} onChange={(e) => setTrackerMarkerImageFile(e.target.files[0] || null)} />
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="submit">Add Marker</button>
                  <button type="button" onClick={() => setTrackerMarkerDraft(null)}>Cancel</button>
                </div>
              </form>
            )}

            {isAuthenticated && trackerMap && (trackerMapPOIs.length > 0 || events.filter((e) => e.map_id === trackerMap.id).length > 0) && (
              <details style={{ marginTop: "1rem" }}>
                <summary style={{ cursor: "pointer", color: "#5d3a1a", fontWeight: "bold" }}>Manage markers on this map</summary>
                <ul style={{ marginTop: "0.5rem" }}>
                  {trackerMapPOIs.map((poi) => (
                    <li key={`poi-${poi.id}`}>
                      {editingPoi?.id === poi.id ? (
                        <form onSubmit={updatePOI} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                          <input value={editingPoi.title} onChange={(e) => setEditingPoi((p) => ({ ...p, title: e.target.value }))} required style={{ flex: "1 1 120px" }} />
                          <input value={editingPoi.description} onChange={(e) => setEditingPoi((p) => ({ ...p, description: e.target.value }))} placeholder="Description" style={{ flex: "1 1 120px" }} />
                          <select value={editingPoi.poi_type} onChange={(e) => setEditingPoi((p) => ({ ...p, poi_type: e.target.value }))}>
                            <option value="location">Location</option>
                            <option value="city">City</option>
                            <option value="dungeon">Dungeon</option>
                            <option value="landmark">Landmark</option>
                            <option value="quest">Quest</option>
                          </select>
                          <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
                            🖼️ {editingPoi.image_path ? "Replace image" : "Add image"}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setEditingPoiImageFile(e.target.files[0] || null)} />
                          </label>
                          {editingPoiImageFile && <small style={{ color: "#5d3a1a" }}>{editingPoiImageFile.name}</small>}
                          <button type="submit">Save</button>
                          <button type="button" onClick={() => { setEditingPoi(null); setEditingPoiImageFile(null); }}>Cancel</button>
                        </form>
                      ) : (
                        <div className="row">
                          <span><strong>{poi.title}</strong> ({poi.poi_type}){poi.description && ` — ${poi.description}`}</span>
                          <div style={{ display: "flex", gap: "0.25rem" }}>
                            <button type="button" onClick={() => setEditingPoi({ id: poi.id, title: poi.title, description: poi.description, poi_type: poi.poi_type })}>Edit</button>
                            <button type="button" onClick={() => deleteTrackerPOI(poi.id)}>Delete</button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                  {events.filter((e) => e.map_id === trackerMap.id).map((ev) => (
                    <li key={`ev-${ev.id}`}>
                      {editingEvent?.id === ev.id ? (
                        <form onSubmit={updateEvent} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                          <input value={editingEvent.title} onChange={(e) => setEditingEvent((p) => ({ ...p, title: e.target.value }))} required style={{ flex: "1 1 120px" }} />
                          <input value={editingEvent.description} onChange={(e) => setEditingEvent((p) => ({ ...p, description: e.target.value }))} placeholder="Description" style={{ flex: "1 1 120px" }} />
                          <select value={editingEvent.event_type} onChange={(e) => setEditingEvent((p) => ({ ...p, event_type: e.target.value }))}>
                            <option value="event">Event</option>
                            <option value="quest">Quest</option>
                          </select>
                          <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
                            🖼️ {editingEvent.image_path ? "Replace image" : "Add image"}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setEditingEventImageFile(e.target.files[0] || null)} />
                          </label>
                          {editingEventImageFile && <small style={{ color: "#5d3a1a" }}>{editingEventImageFile.name}</small>}
                          <button type="submit">Save</button>
                          <button type="button" onClick={() => { setEditingEvent(null); setEditingEventImageFile(null); }}>Cancel</button>
                        </form>
                      ) : (
                        <div className="row">
                          <span><strong>{ev.title}</strong> ({ev.event_type})</span>
                          <div style={{ display: "flex", gap: "0.25rem" }}>
                            <button type="button" onClick={() => setEditingEvent({ id: ev.id, title: ev.title, description: ev.description, event_type: ev.event_type, latitude: ev.latitude, longitude: ev.longitude, map_id: ev.map_id, image_path: ev.image_path })}>Edit</button>
                            <button type="button" onClick={() => deleteEvent(ev.id)}>Delete</button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>

          <article className="card">
            <h2>Party Resources</h2>
            {isAuthenticated && (
              <form onSubmit={submitResource} className="form" style={{ marginBottom: "1rem" }}>
                <input
                  value={resourceDraft.name}
                  onChange={(e) => setResourceDraft((old) => ({ ...old, name: e.target.value }))}
                  placeholder="Resource name"
                  required
                />
                <input
                  type="number"
                  min="0"
                  value={resourceDraft.quantity}
                  onChange={(e) => setResourceDraft((old) => ({ ...old, quantity: e.target.value }))}
                  placeholder="Quantity"
                  required
                />
                <input
                  value={resourceDraft.notes}
                  onChange={(e) => setResourceDraft((old) => ({ ...old, notes: e.target.value }))}
                  placeholder="Notes"
                />
                <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                  🖼️ Image (optional)
                  <input type="file" accept="image/*" style={{ marginLeft: "0.5rem" }} onChange={(e) => setResourceImageFile(e.target.files[0] || null)} />
                </label>
                {resourceImageFile && <small style={{ color: "#5d3a1a" }}>{resourceImageFile.name}</small>}
                <button type="submit">Add Resource</button>
                {resourceError ? <p className="error">{resourceError}</p> : null}
              </form>
            )}
            <ul>
              {resources.map((item) => (
                <li key={item.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0", borderBottom: "1px solid #e8d5b0", flexWrap: "wrap" }}>
                  {item.image_path ? (
                    <img
                      src={`${API_URL}/${item.image_path}`}
                      alt={item.name}
                      onClick={() => setSelectedResourceImage(`${API_URL}/${item.image_path}`)}
                      style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "4px", cursor: "pointer", border: "2px solid #8b4513" }}
                      title="Click to view"
                    />
                  ) : isAuthenticated ? (
                    <label style={{ fontSize: "0.8rem", cursor: "pointer", color: "#8b4513", whiteSpace: "nowrap" }} title="Add image">
                      🖼️
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadResourceImage(item.id, e.target.files[0]); }} />
                    </label>
                  ) : null}
                  <span style={{ flexGrow: 1 }}><strong>{item.name}</strong>: {item.quantity}{item.notes ? ` (${item.notes})` : ""}</span>
                  {isAuthenticated && item.image_path && (
                    <label style={{ fontSize: "0.8rem", cursor: "pointer", color: "#8b4513" }} title="Replace image">
                      🔄
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadResourceImage(item.id, e.target.files[0]); }} />
                    </label>
                  )}
                  {isAuthenticated && <button type="button" onClick={() => deleteResource(item.id)}>Delete</button>}
                </li>
              ))}
            </ul>
          </article>

          {selectedResourceImage && (
            <div
              onClick={() => setSelectedResourceImage(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}
            >
              <img src={selectedResourceImage} alt="Resource" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
            </div>
          )}

          <article className="card">
            <h2>Adventure Diary</h2>
            {isAuthenticated && (
              <form onSubmit={submitDiary} className="form" style={{ marginBottom: "1rem" }}>
                <input
                  value={diaryDraft.title}
                  onChange={(e) => setDiaryDraft((old) => ({ ...old, title: e.target.value }))}
                  placeholder="Entry title"
                  required
                />
                <textarea
                  value={diaryDraft.content}
                  onChange={(e) => setDiaryDraft((old) => ({ ...old, content: e.target.value }))}
                  placeholder="What happened this session?"
                  rows={4}
                  required
                />
                <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                  🖼️ Image (optional)
                  <input type="file" accept="image/*" style={{ marginLeft: "0.5rem" }} onChange={(e) => setDiaryImageFile(e.target.files[0] || null)} />
                </label>
                {diaryImageFile && <small style={{ color: "#5d3a1a" }}>{diaryImageFile.name}</small>}
                <button type="submit">Add Entry</button>
                {diaryError ? <p className="error">{diaryError}</p> : null}
              </form>
            )}
            <ul>
              {diaryEntries.map((entry) => (
                <li key={entry.id} style={{ borderBottom: "1px solid #e8d5b0", paddingBottom: "0.75rem", marginBottom: "0.75rem" }}>
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <strong>{entry.title}</strong>
                    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                      {isAuthenticated && (
                        <label style={{ fontSize: "0.8rem", cursor: "pointer" }} title={entry.image_path ? "Replace image" : "Add image"}>
                          🖼️
                          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadDiaryImage(entry.id, e.target.files[0]); }} />
                        </label>
                      )}
                      {isAuthenticated && <button type="button" onClick={() => deleteDiaryEntry(entry.id)}>Delete</button>}
                    </div>
                  </div>
                  <p style={{ margin: "0.25rem 0" }}>{entry.content}</p>
                  {entry.image_path && (
                    <img
                      src={`${API_URL}/${entry.image_path}`}
                      alt={entry.title}
                      onClick={() => setSelectedDiaryImage(`${API_URL}/${entry.image_path}`)}
                      style={{ maxWidth: "100%", maxHeight: "200px", objectFit: "contain", borderRadius: "4px", cursor: "pointer", marginTop: "0.5rem", border: "1px solid #ddd" }}
                      title="Click to view full size"
                    />
                  )}
                </li>
              ))}
            </ul>
          </article>

          {selectedDiaryImage && (
            <div onClick={() => setSelectedDiaryImage(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
              <img src={selectedDiaryImage} alt="Diary entry" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
            </div>
          )}
        </section>
      ) : null}

      {/* CHARACTERS VIEW */}
      {activeView === "characters" && isAuthenticated ? (
        <section className="grid">
          <article className="card wide">
            <h2>My Characters</h2>
            {!selectedCharacter ? (
              <>
                <form onSubmit={submitCharacter} className="form">
                  <input
                    value={characterDraft.name}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, name: e.target.value }))}
                    placeholder="Character Name"
                    required
                  />
                  <input
                    value={characterDraft.character_class}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, character_class: e.target.value }))}
                    placeholder="Class"
                  />
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={characterDraft.level}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, level: Number(e.target.value) }))}
                    placeholder="Level"
                  />
                  <input
                    value={characterDraft.race}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, race: e.target.value }))}
                    placeholder="Race"
                  />
                  <textarea
                    value={characterDraft.notes}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, notes: e.target.value }))}
                    placeholder="Notes"
                    rows={3}
                  />
                  <select
                    value={characterDraft.organization_id ?? ""}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, organization_id: e.target.value ? Number(e.target.value) : null }))}
                  >
                    <option value="">No organization</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                  <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                    🖼️ {characterImageFile ? characterImageFile.name : "Add portrait (optional)"}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setCharacterImageFile(e.target.files[0] || null)} />
                  </label>
                  <button type="submit">Create Character</button>
                </form>
                {characterError ? <p className="error">{characterError}</p> : null}

                <h3>Your Characters</h3>
                <ul>
                  {characters.map((char) => (
                    <li key={char.id} className="row" style={{ alignItems: "center", gap: "0.75rem" }}>
                      {char.image_path ? (
                        <img
                          src={`${API_URL}/${char.image_path}`}
                          alt={char.name}
                          onClick={() => setSelectedCharacterImage(`${API_URL}/${char.image_path}`)}
                          style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "50%", cursor: "pointer", border: "2px solid #8b4513", flexShrink: 0 }}
                          title="Click to view"
                        />
                      ) : (
                        <span style={{ fontSize: "2rem", flexShrink: 0 }}>🧙</span>
                      )}
                      <span style={{ flexGrow: 1 }}>
                        <strong>{char.name}</strong> - Lvl {char.level} {char.race} {char.character_class}
                        {char.organization_id && organizations.find((o) => o.id === char.organization_id) && (
                          <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", background: "#8b4513", color: "#fff", borderRadius: "4px", padding: "1px 6px" }}>
                            {organizations.find((o) => o.id === char.organization_id).name}
                          </span>
                        )}
                      </span>
                      <div>
                        <button type="button" onClick={() => loadCharacterDetails(char)}>
                          View
                        </button>
                        {char.sheet_file_path && (
                          <a href={`${API_URL}/${char.sheet_file_path}`} target="_blank" rel="noreferrer">
                            <button type="button">Sheet</button>
                          </a>
                        )}
                        <button type="button" onClick={() => deleteCharacter(char.id)}>
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setSelectedCharacter(null)}>
                  ← Back to Characters
                </button>
                <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", marginBottom: "1rem" }}>
                  <div style={{ flexShrink: 0 }}>
                    {selectedCharacter.image_path ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
                        <img
                          src={`${API_URL}/${selectedCharacter.image_path}`}
                          alt={selectedCharacter.name}
                          onClick={() => setSelectedCharacterImage(`${API_URL}/${selectedCharacter.image_path}`)}
                          style={{ width: "96px", height: "96px", objectFit: "cover", borderRadius: "50%", cursor: "pointer", border: "3px solid #8b4513" }}
                          title="Click to view"
                        />
                        <label style={{ fontSize: "0.8rem", cursor: "pointer", color: "#5d3a1a" }} title="Replace portrait">
                          🔄 Replace
                          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadCharacterImage(selectedCharacter.id, e.target.files[0]); }} />
                        </label>
                      </div>
                    ) : (
                      <label style={{ width: "96px", height: "96px", border: "2px dashed #8b4513", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexDirection: "column", gap: "0.25rem", fontSize: "0.75rem", color: "#5d3a1a" }} title="Add portrait">
                        🧙<span>Add portrait</span>
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadCharacterImage(selectedCharacter.id, e.target.files[0]); }} />
                      </label>
                    )}
                  </div>
                  <div>
                    <h3 style={{ margin: "0 0 0.25rem" }}>
                      {selectedCharacter.name} - Lvl {selectedCharacter.level} {selectedCharacter.race} {selectedCharacter.character_class}
                    </h3>
                    {selectedCharacter.organization_id && organizations.find((o) => o.id === selectedCharacter.organization_id) && (
                      <span style={{ fontSize: "0.85rem", background: "#8b4513", color: "#fff", borderRadius: "4px", padding: "2px 8px", display: "inline-block", marginBottom: "0.5rem" }}>
                        🏰 {organizations.find((o) => o.id === selectedCharacter.organization_id).name}
                      </span>
                    )}
                    {selectedCharacter.notes && <p style={{ margin: 0 }}>{selectedCharacter.notes}</p>}
                  </div>
                </div>

                <h4>Upload Character Sheet</h4>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => e.target.files[0] && uploadCharacterSheet(selectedCharacter.id, e.target.files[0])}
                />

                <h4>Inventory</h4>
                <form onSubmit={addInventoryItem} className="form">
                  <input
                    value={inventoryDraft.item_name}
                    onChange={(e) => setInventoryDraft((old) => ({ ...old, item_name: e.target.value }))}
                    placeholder="Item name"
                    required
                  />
                  <input
                    type="number"
                    min="1"
                    value={inventoryDraft.quantity}
                    onChange={(e) => setInventoryDraft((old) => ({ ...old, quantity: Number(e.target.value) }))}
                    placeholder="Quantity"
                  />
                  <input
                    value={inventoryDraft.description}
                    onChange={(e) => setInventoryDraft((old) => ({ ...old, description: e.target.value }))}
                    placeholder="Description"
                  />
                  <button type="submit">Add Item</button>
                </form>
                <ul>
                  {characterInventory.map((item) => (
                    <li key={item.id} className="row">
                      <span>
                        <strong>{item.item_name}</strong> x{item.quantity}
                        {item.description ? ` - ${item.description}` : ""}
                      </span>
                      <button type="button" onClick={() => deleteInventoryItem(item.id)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>

                <h4>Diary</h4>
                <form onSubmit={addCharacterDiaryEntry} className="form">
                  <input
                    value={charDiaryDraft.title}
                    onChange={(e) => setCharDiaryDraft((old) => ({ ...old, title: e.target.value }))}
                    placeholder="Entry title"
                    required
                  />
                  <textarea
                    value={charDiaryDraft.content}
                    onChange={(e) => setCharDiaryDraft((old) => ({ ...old, content: e.target.value }))}
                    placeholder="What happened?"
                    rows={4}
                    required
                  />
                  <button type="submit">Add Entry</button>
                </form>
                <ul>
                  {characterDiary.map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.title}</strong>
                      <p>{entry.content}</p>
                      <small>{new Date(entry.created_at).toLocaleDateString()}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </article>
        </section>
      ) : null}

      {/* BESTIARY VIEW */}
      {activeView === "bestiary" ? (
        <section className="grid">
          <article className="card wide">
            <h2>Bestiary</h2>
            <h3>Encountered Creatures</h3>
            <ul>
              {creatures.map((creature) => (
                <li key={creature.id} style={{ marginBottom: "1rem", padding: "0.5rem", border: "1px solid #ddd", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                  {creature.image_path ? (
                    <img
                      src={`${API_URL}/${creature.image_path}`}
                      alt={creature.name}
                      onClick={() => setSelectedCreatureImage(`${API_URL}/${creature.image_path}`)}
                      style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "4px", cursor: "pointer", border: "2px solid #8b4513", flexShrink: 0 }}
                      title="Click to view"
                    />
                  ) : isAdmin ? (
                    <label style={{ width: "64px", height: "64px", border: "2px dashed #8b4513", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontSize: "1.8rem" }} title="Add image">
                      🐉
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadCreatureImage(creature.id, e.target.files[0]); }} />
                    </label>
                  ) : (
                    <span style={{ fontSize: "2rem", flexShrink: 0 }}>🐉</span>
                  )}
                  <div style={{ flexGrow: 1 }}>
                    <div className="row">
                      <strong>{creature.name}</strong>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        {isAdmin && creature.image_path && (
                          <label style={{ fontSize: "0.8rem", cursor: "pointer" }} title="Replace image">
                            🔄
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadCreatureImage(creature.id, e.target.files[0]); }} />
                          </label>
                        )}
                        {isAdmin && (
                          <button type="button" onClick={() => deleteCreature(creature.id)}>Delete</button>
                        )}
                      </div>
                    </div>
                    {creature.creature_type && <p><strong>Type:</strong> {creature.creature_type}</p>}
                    {creature.challenge_rating && <p><strong>CR:</strong> {creature.challenge_rating}</p>}
                    {creature.armor_class > 0 && <p><strong>AC:</strong> {creature.armor_class}</p>}
                    {creature.hit_points && <p><strong>HP:</strong> {creature.hit_points}</p>}
                    {creature.speed && <p><strong>Speed:</strong> {creature.speed}</p>}
                    {creature.abilities && <p><strong>Abilities:</strong> {creature.abilities}</p>}
                    {creature.weaknesses && <p><strong>Weaknesses:</strong> {creature.weaknesses}</p>}
                    {creature.resistances && <p><strong>Resistances:</strong> {creature.resistances}</p>}
                    {creature.immunities && <p><strong>Immunities:</strong> {creature.immunities}</p>}
                    {creature.notes && <p><strong>Notes:</strong> {creature.notes}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </section>
      ) : null}

      {selectedCreatureImage && (
        <div onClick={() => setSelectedCreatureImage(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
          <img src={selectedCreatureImage} alt="Creature" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
        </div>
      )}

      {selectedCharacterImage && (
        <div onClick={() => setSelectedCharacterImage(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
          <img src={selectedCharacterImage} alt="Character" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
        </div>
      )}

      {/* ORGANIZATIONS VIEW */}
      {activeView === "organizations" ? (
        <section style={{ padding: "1rem", maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ margin: 0 }}>🏰 Organizations</h2>
          </div>

          {organizations.length === 0 && (
            <p style={{ color: "#888", textAlign: "center", marginTop: "2rem" }}>No organizations yet.</p>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            {organizations.map((org) => {
              const memberCount = allies.filter((a) => a.organization_id === org.id).length;
              const isSelected = selectedOrg?.id === org.id;
              return (
                <div
                  key={org.id}
                  onClick={() => setSelectedOrg(isSelected ? null : org)}
                  style={{ width: "220px", border: `2px solid ${isSelected ? "#8b4513" : "#c8a87a"}`, borderRadius: "8px", overflow: "hidden", cursor: "pointer", background: isSelected ? "#f9f0e0" : "#fff", boxShadow: isSelected ? "0 2px 12px rgba(139,69,19,0.2)" : "0 1px 4px rgba(0,0,0,0.08)", transition: "box-shadow 0.15s" }}
                >
                  <div style={{ height: "120px", background: "#e8d5b0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {org.image_path ? (
                      <img src={`${API_URL}/${org.image_path}`} alt={org.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: "3rem" }}>🏰</span>
                    )}
                  </div>
                  <div style={{ padding: "0.6rem 0.75rem" }}>
                    <strong style={{ display: "block", marginBottom: "0.2rem" }}>{org.name}</strong>
                    {org.description && <p style={{ margin: "0 0 0.4rem", fontSize: "0.82rem", color: "#666", lineHeight: 1.3 }}>{org.description}</p>}
                    <small style={{ color: "#8b4513" }}>{memberCount} member{memberCount !== 1 ? "s" : ""}</small>
                    {isAdmin && (
                      <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
                        <label style={{ fontSize: "0.78rem", cursor: "pointer", color: "#8b4513", background: "#f9f0e0", border: "1px solid #c8a87a", borderRadius: "3px", padding: "2px 6px" }} title="Replace image">
                          🖼️ Image
                          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadOrganizationImage(org.id, e.target.files[0]); }} />
                        </label>
                        <button type="button" onClick={() => deleteOrganization(org.id)} style={{ fontSize: "0.78rem", padding: "2px 6px" }}>Delete</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedOrg && (
            <div style={{ marginTop: "1.5rem", border: "2px solid #8b4513", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1rem", background: "#f9f0e0", borderBottom: "1px solid #c8a87a" }}>
                {selectedOrg.image_path && (
                  <img
                    src={`${API_URL}/${selectedOrg.image_path}`}
                    alt={selectedOrg.name}
                    onClick={(e) => { e.stopPropagation(); setSelectedOrgImage(`${API_URL}/${selectedOrg.image_path}`); }}
                    style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "6px", cursor: "zoom-in", border: "2px solid #8b4513", flexShrink: 0 }}
                  />
                )}
                <div style={{ flexGrow: 1 }}>
                  <h3 style={{ margin: 0 }}>{selectedOrg.name}</h3>
                  {selectedOrg.description && <p style={{ margin: "0.2rem 0 0", color: "#5d3a1a", fontSize: "0.9rem" }}>{selectedOrg.description}</p>}
                </div>
                <button type="button" onClick={() => setSelectedOrg(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "#8b4513" }}>✕</button>
              </div>
              <div style={{ padding: "1rem" }}>
                <h4 style={{ margin: "0 0 0.75rem" }}>Members</h4>
                {allies.filter((a) => a.organization_id === selectedOrg.id).length === 0 ? (
                  <p style={{ color: "#888", margin: 0 }}>No NPCs assigned to this organization yet. Assign them from the NPCs tab.</p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                    {allies.filter((a) => a.organization_id === selectedOrg.id).map((ally) => (
                      <div key={ally.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.75rem", border: "1px solid #e8d5b0", borderRadius: "6px", background: "#fdf8f0" }}>
                        {ally.image_path ? (
                          <img src={`${API_URL}/${ally.image_path}`} alt={ally.name} style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "50%", border: "2px solid #8b4513" }} />
                        ) : (
                          <span style={{ fontSize: "1.4rem" }}>👤</span>
                        )}
                        <div>
                          <strong style={{ fontSize: "0.9rem" }}>{ally.name}</strong>
                          {ally.role && <p style={{ margin: 0, fontSize: "0.78rem", color: "#666" }}>{ally.role}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedOrgImage && (
            <div onClick={() => setSelectedOrgImage(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
              <img src={selectedOrgImage} alt="Organization" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
            </div>
          )}
        </section>
      ) : null}

      {/* NPCS VIEW */}
      {activeView === "npcs" ? (
        <section className="grid">
          <article className="card wide">
            <h2>👤 NPCs</h2>

            <h3>Known NPCs</h3>
            <ul>
              {allies.map((ally) => {
                const org = organizations.find((o) => o.id === ally.organization_id);
                return (
                  <li key={ally.id} style={{ marginBottom: "1rem", padding: "0.5rem", border: "1px solid #ddd", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                    {ally.image_path ? (
                      <img
                        src={`${API_URL}/${ally.image_path}`}
                        alt={ally.name}
                        onClick={() => setSelectedAllyImage(`${API_URL}/${ally.image_path}`)}
                        style={{ width: "56px", height: "56px", objectFit: "cover", borderRadius: "50%", cursor: "pointer", border: "2px solid #8b4513", flexShrink: 0 }}
                        title="Click to view"
                      />
                    ) : isAdmin ? (
                      <label style={{ width: "56px", height: "56px", borderRadius: "50%", border: "2px dashed #8b4513", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontSize: "1.4rem" }} title="Add portrait">
                        👤
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadAllyImage(ally.id, e.target.files[0]); }} />
                      </label>
                    ) : (
                      <span style={{ width: "56px", height: "56px", borderRadius: "50%", border: "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", flexShrink: 0 }}>👤</span>
                    )}
                    <div style={{ flexGrow: 1 }}>
                      <div className="row">
                        <div>
                          <strong>{ally.name}</strong>
                          {org && (
                            <span
                              onClick={() => { navigate("organizations"); setSelectedOrg(org); }}
                              style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "#8b4513", cursor: "pointer", textDecoration: "underline" }}
                              title="Go to organization"
                            >({org.name})</span>
                          )}
                          {ally.alignment === "allied" && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", background: "#2d6a2d", color: "#fff", borderRadius: "4px", padding: "1px 6px" }}>✅ Allied</span>}
                          {ally.alignment === "foe" && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", background: "#8b1a1a", color: "#fff", borderRadius: "4px", padding: "1px 6px" }}>⚔️ Foe</span>}
                          {ally.alignment === "neutral" && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", background: "#666", color: "#fff", borderRadius: "4px", padding: "1px 6px" }}>➖ Neutral</span>}
                        </div>
                        <div style={{ display: "flex", gap: "0.25rem" }}>
                          {isAdmin && ally.image_path && (
                            <label style={{ fontSize: "0.8rem", cursor: "pointer" }} title="Replace portrait">
                              🔄
                              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadAllyImage(ally.id, e.target.files[0]); }} />
                            </label>
                          )}
                          {isAdmin && <button type="button" onClick={() => deleteAlly(ally.id)}>Delete</button>}
                        </div>
                      </div>
                      {isAuthenticated && (
                        <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.4rem" }}>
                          <button
                            type="button"
                            onClick={() => setAllyAlignment(ally.id, "allied")}
                            style={{ fontSize: "0.75rem", padding: "2px 8px", background: ally.alignment === "allied" ? "#2d6a2d" : undefined, color: ally.alignment === "allied" ? "#fff" : undefined }}
                          >✅ Allied</button>
                          <button
                            type="button"
                            onClick={() => setAllyAlignment(ally.id, "neutral")}
                            style={{ fontSize: "0.75rem", padding: "2px 8px", background: ally.alignment === "neutral" ? "#555" : undefined, color: ally.alignment === "neutral" ? "#fff" : undefined }}
                          >➖ Neutral</button>
                          <button
                            type="button"
                            onClick={() => setAllyAlignment(ally.id, "foe")}
                            style={{ fontSize: "0.75rem", padding: "2px 8px", background: ally.alignment === "foe" ? "#8b1a1a" : undefined, color: ally.alignment === "foe" ? "#fff" : undefined }}
                          >⚔️ Foe</button>
                        </div>
                      )}
                      {ally.role && <p style={{ margin: "0.2rem 0 0" }}><strong>Role:</strong> {ally.role}</p>}
                      {ally.location && <p style={{ margin: "0.2rem 0 0" }}><strong>Location:</strong> {ally.location}</p>}
                      {ally.relationship && <p style={{ margin: "0.2rem 0 0" }}><strong>Relationship:</strong> {ally.relationship}</p>}
                      {ally.notes && <p style={{ margin: "0.2rem 0 0" }}><strong>Notes:</strong> {ally.notes}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </article>
        </section>
      ) : null}

      {selectedAllyImage && (
        <div onClick={() => setSelectedAllyImage(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
          <img src={selectedAllyImage} alt="NPC portrait" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
        </div>
      )}

      {/* ADMIN VIEW (/admin) */}
      {activeView === "admin" && isAuthenticated && isAdmin ? (
        <section className="grid">
          <article className="card wide">
            <h2>🗺️ Manage Maps</h2>
            <h3>Upload New Map</h3>
            <form onSubmit={uploadMap} className="form">
              <input name="name" placeholder="Map Name" required />
              <input name="description" placeholder="Description" />
              <input name="file" type="file" accept="image/*" required />
              <button type="submit">Upload Map</button>
            </form>

            <h3>Uploaded Maps</h3>
            <ul>
              {maps.map((map) => (
                <li key={map.id} className="row">
                  <span>
                    <strong>{map.name}</strong> {map.description && `- ${map.description}`}
                  </span>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMap(map);
                        loadMapPOIs(map.id);
                      }}
                    >
                      Manage POIs
                    </button>
                    <button type="button" onClick={() => deleteMap(map.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {selectedMap && (
              <>
                <h3>Manage Points of Interest - {selectedMap.name}</h3>
                <button type="button" onClick={() => { setSelectedMap(null); setPoiDraft(null); }} style={{ marginBottom: "1rem" }}>
                  ← Back to Maps
                </button>
                <p>Click the map to place a new POI.</p>
                <MapView
                  events={selectedMapPOIs}
                  onMapClick={addPOI}
                  mapImageUrl={`${API_URL}/${selectedMap.file_path}`}
                  tempMarker={poiDraft}
                />
                {poiDraft && (
                  <form onSubmit={submitPOI} className="form" style={{ marginTop: "1rem", padding: "1rem", background: "#f9f0e0", border: "2px solid #8b4513", borderRadius: "4px" }}>
                    <p style={{ margin: 0 }}><strong>📌 New POI</strong> at {poiDraft.latitude.toFixed(1)}%, {poiDraft.longitude.toFixed(1)}%</p>
                    <input
                      value={poiDraftData.title}
                      onChange={(e) => setPoiDraftData((d) => ({ ...d, title: e.target.value }))}
                      placeholder="Title"
                      required
                    />
                    <input
                      value={poiDraftData.description}
                      onChange={(e) => setPoiDraftData((d) => ({ ...d, description: e.target.value }))}
                      placeholder="Description (optional)"
                    />
                    <select value={poiDraftData.poi_type} onChange={(e) => setPoiDraftData((d) => ({ ...d, poi_type: e.target.value }))}>
                      <option value="location">Location</option>
                      <option value="city">City</option>
                      <option value="dungeon">Dungeon</option>
                      <option value="landmark">Landmark</option>
                      <option value="quest">Quest</option>
                    </select>
                    <label style={{ fontSize: "0.9rem" }}>Image (optional):
                      <input type="file" accept="image/*" style={{ marginLeft: "0.5rem" }} onChange={(e) => setPoiImageFile(e.target.files[0] || null)} />
                    </label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button type="submit">Add POI</button>
                      <button type="button" onClick={() => setPoiDraft(null)}>Cancel</button>
                    </div>
                  </form>
                )}
                <ul style={{ marginTop: "1rem" }}>
                  {selectedMapPOIs.map((poi) => (
                    <li key={poi.id} style={{ marginBottom: "0.5rem" }}>
                      {editingPoi?.id === poi.id ? (
                        <form onSubmit={updatePOI} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                          <input value={editingPoi.title} onChange={(e) => setEditingPoi((p) => ({ ...p, title: e.target.value }))} required style={{ flex: "1 1 120px" }} />
                          <input value={editingPoi.description} onChange={(e) => setEditingPoi((p) => ({ ...p, description: e.target.value }))} placeholder="Description" style={{ flex: "1 1 120px" }} />
                          <select value={editingPoi.poi_type} onChange={(e) => setEditingPoi((p) => ({ ...p, poi_type: e.target.value }))}>
                            <option value="location">Location</option>
                            <option value="city">City</option>
                            <option value="dungeon">Dungeon</option>
                            <option value="landmark">Landmark</option>
                            <option value="quest">Quest</option>
                          </select>
                          <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
                            🖼️ {editingPoi.image_path ? "Replace image" : "Add image"}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setEditingPoiImageFile(e.target.files[0] || null)} />
                          </label>
                          {editingPoiImageFile && <small style={{ color: "#5d3a1a" }}>{editingPoiImageFile.name}</small>}
                          <button type="submit">Save</button>
                          <button type="button" onClick={() => { setEditingPoi(null); setEditingPoiImageFile(null); }}>Cancel</button>
                        </form>
                      ) : (
                        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                          <span style={{ flexGrow: 1 }}>
                            <strong>{poi.title}</strong> ({poi.poi_type}){poi.description && ` — ${poi.description}`}
                          </span>
                          {poi.image_path ? (
                            <img src={`${API_URL}/${poi.image_path}`} alt={poi.title} style={{ height: "36px", borderRadius: "3px" }} />
                          ) : (
                            <label style={{ fontSize: "0.8rem", cursor: "pointer" }}>
                              🖼️ Add image
                              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadPOIImage(poi.id, e.target.files[0]); }} />
                            </label>
                          )}
                          <button type="button" onClick={() => setEditingPoi({ id: poi.id, title: poi.title, description: poi.description, poi_type: poi.poi_type })}>Edit</button>
                          <button type="button" onClick={() => deletePOI(poi.id)}>Delete</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </article>

          <article className="card wide">
            <h2>🐉 Manage Bestiary</h2>
            <h3>Add Creature</h3>
            <form onSubmit={submitCreature} className="form">
              <input
                value={creatureDraft.name}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, name: e.target.value }))}
                placeholder="Creature Name"
                required
              />
              <input
                value={creatureDraft.creature_type}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, creature_type: e.target.value }))}
                placeholder="Type (e.g., Dragon, Undead)"
              />
              <input
                value={creatureDraft.challenge_rating}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, challenge_rating: e.target.value }))}
                placeholder="Challenge Rating"
              />
              <input
                type="number"
                value={creatureDraft.armor_class}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, armor_class: Number(e.target.value) }))}
                placeholder="Armor Class"
              />
              <input
                value={creatureDraft.hit_points}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, hit_points: e.target.value }))}
                placeholder="Hit Points"
              />
              <input
                value={creatureDraft.speed}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, speed: e.target.value }))}
                placeholder="Speed"
              />
              <textarea
                value={creatureDraft.abilities}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, abilities: e.target.value }))}
                placeholder="Abilities"
                rows={2}
              />
              <textarea
                value={creatureDraft.weaknesses}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, weaknesses: e.target.value }))}
                placeholder="Weaknesses"
                rows={2}
              />
              <textarea
                value={creatureDraft.resistances}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, resistances: e.target.value }))}
                placeholder="Resistances"
                rows={2}
              />
              <textarea
                value={creatureDraft.immunities}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, immunities: e.target.value }))}
                placeholder="Immunities"
                rows={2}
              />
              <textarea
                value={creatureDraft.notes}
                onChange={(e) => setCreatureDraft((old) => ({ ...old, notes: e.target.value }))}
                placeholder="Notes"
                rows={3}
              />
              <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                🖼️ Image (optional)
                <input type="file" accept="image/*" style={{ marginLeft: "0.5rem" }} onChange={(e) => setCreatureImageFile(e.target.files[0] || null)} />
              </label>
              {creatureImageFile && <small style={{ color: "#5d3a1a" }}>{creatureImageFile.name}</small>}
              <button type="submit">Add Creature</button>
            </form>
            {creatureError ? <p className="error">{creatureError}</p> : null}
          </article>

          <article className="card wide">
            <h2>🏰 Manage Organizations</h2>
            <h3>Add Organization</h3>
            <form onSubmit={submitOrganization} className="form">
              <input
                value={orgDraft.name}
                onChange={(e) => setOrgDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Organization name"
                required
              />
              <input
                value={orgDraft.description}
                onChange={(e) => setOrgDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Description (optional)"
              />
              <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                🖼️ {orgImageFile ? orgImageFile.name : "Add image (optional)"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setOrgImageFile(e.target.files[0] || null)} />
              </label>
              <button type="submit">Add Organization</button>
            </form>
            {orgError ? <p className="error">{orgError}</p> : null}
          </article>

          <article className="card wide">
            <h2>👤 Manage NPCs</h2>
            <h3>Add NPC</h3>
            <form onSubmit={submitAlly} className="form">
              <input
                value={allyDraft.name}
                onChange={(e) => setAllyDraft((old) => ({ ...old, name: e.target.value }))}
                placeholder="Name"
                required
              />
              <input
                value={allyDraft.role}
                onChange={(e) => setAllyDraft((old) => ({ ...old, role: e.target.value }))}
                placeholder="Role (e.g., Merchant, Guard)"
              />
              <input
                value={allyDraft.location}
                onChange={(e) => setAllyDraft((old) => ({ ...old, location: e.target.value }))}
                placeholder="Location"
              />
              <textarea
                value={allyDraft.relationship}
                onChange={(e) => setAllyDraft((old) => ({ ...old, relationship: e.target.value }))}
                placeholder="Relationship with party"
                rows={2}
              />
              <textarea
                value={allyDraft.notes}
                onChange={(e) => setAllyDraft((old) => ({ ...old, notes: e.target.value }))}
                placeholder="Notes"
                rows={3}
              />
              <select
                value={allyDraft.organization_id ?? ""}
                onChange={(e) => setAllyDraft((old) => ({ ...old, organization_id: e.target.value ? Number(e.target.value) : null }))}
              >
                <option value="">— No organization —</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
              <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                🖼️ {allyImageFile ? allyImageFile.name : "Portrait (optional)"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setAllyImageFile(e.target.files[0] || null)} />
              </label>
              <button type="submit">Add NPC</button>
            </form>
            {allyError ? <p className="error">{allyError}</p> : null}
          </article>

          <article className="card wide">
            <h2>👥 User Management</h2>
            <button type="button" onClick={loadUsers} style={{ marginBottom: "1rem" }}>
              Load Users
            </button>
            {users.length > 0 && (
              <ul>
                {users.map((u) => (
                  <li key={u.id} className="row">
                    <span>
                      <strong>{u.username}</strong>
                      {u.is_admin ? (
                        <span style={{ marginLeft: "0.5rem", color: "#8b4513", fontWeight: "bold" }}>👑 Admin</span>
                      ) : (
                        <span style={{ marginLeft: "0.5rem", color: "#666" }}>🗡️ Player</span>
                      )}
                    </span>
                    <button type="button" onClick={() => toggleAdmin(u.id, u.is_admin)}>
                      {u.is_admin ? "Remove Admin" : "Make Admin"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {users.length === 0 && <p><small>Click "Load Users" to see all registered users.</small></p>}
          </article>
        </section>
      ) : activeView === "admin" && !isAuthenticated ? (
        <section className="grid">
          <article className="card">
            <h2>🔓 Login Required</h2>
            <p>You must be logged in with an admin account to access this page.</p>
            <button type="button" onClick={() => navigate("login")} style={{ marginTop: "1rem" }}>
              Go to Login
            </button>
          </article>
        </section>
      ) : activeView === "admin" && isAuthenticated && !isAdmin ? (
        <section className="grid">
          <article className="card">
            <h2>🔒 Access Denied</h2>
            <p>You do not have administrator privileges.</p>
          </article>
        </section>
      ) : null}
    </main>
  );
}

export default App;
