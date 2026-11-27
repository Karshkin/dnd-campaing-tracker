import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from 'react-i18next';

import { ImageGallery, CharacterSheet, defaultCharacterEmoji, SheetFields, sheetDraft } from "./CharacterSheet";
import { CampaignEntryTools } from "./CampaignEntryEditor";
import { campaignRequest, readProfile, supabase } from "./campaign";
const PAGE_KEYS = ["tracker", "characters", "bestiary", "organizations", "npcs", "admin"];
const PERMISSION_OPTIONS = ["none", "view", "edit", "admin"];
const PERMISSION_RANK = { none: 0, view: 1, edit: 2, admin: 3 };

const languages = [
  { code: "ca", name: "Català" },
  { code: "es", name: "Español" },
  { code: "en", name: "English" },
];

function LanguagePicker() {
  const { t, i18n } = useTranslation();
  return (
    <div className="language-picker" role="group" aria-label={t("nav.language")}>
      {languages.map(({ code, name }) => (
        <button key={code} type="button" lang={code} aria-label={name} title={name}
          aria-pressed={i18n.resolvedLanguage === code} onClick={() => i18n.changeLanguage(code)}>
          <span className={`language-flag language-flag-${code}`} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

const emptyCollection = [];
const blankCharacter = () => ({
  name: "", character_class: "", level: 1, race: "", notes: "", organization_id: null, ...sheetDraft(),
});

function useCampaignData(path, enabled, onError) {
  const [data, setData] = useState(emptyCollection);
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++latest.current;
    if (!enabled) {
      setData(emptyCollection);
      return;
    }
    const response = await campaignRequest(path);
    const payload = await response.json();
    if (request !== latest.current) return;
    if (response.ok) setData(payload);
    else onError(payload.detail);
  }, [path, enabled, onError]);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 12 * 60 * 1000);
    return () => {
      ++latest.current;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  return [enabled ? data : emptyCollection, refresh];
}

function hasLevel(actual, required) {
  return (PERMISSION_RANK[actual] ?? 0) >= (PERMISSION_RANK[required] ?? 0);
}

// ===== MAP COMPONENT =====
function MapView({ events, onMapClick, readonly = false, mapImageUrl = null, mapId, tempMarker = null }) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const innerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [selection, setSelection] = useState(null);
  const dragRef = useRef(null);
  const didDragRef = useRef(false);

  const markers = useMemo(() => {
    return events.map((event) => ({
      ...event,
      markerKey: `${event.event_type ? "event" : "poi"}-${event.id}`,
      top: `${event.latitude}%`,
      left: `${event.longitude}%`,
    }));
  }, [events]);

  useEffect(() => setSelection(null), [mapId]);

  const activeMarker = selection?.mapId === mapId
    ? markers.find((marker) => marker.markerKey === selection?.markerKey)
    : null;

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
    onMapClick({ latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)) });
  };

  const handleMarkerClick = (e, marker) => {
    e.stopPropagation();
    if (e.detail !== 0 && didDragRef.current) return;
    setSelection(activeMarker?.markerKey === marker.markerKey ? null : { mapId, markerKey: marker.markerKey });
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const cursorStyle = isDragging ? "grabbing" : readonly ? "grab" : "crosshair";

  return (
    <div>
      <div className="map-popup-anchor" onKeyDown={(event) => {
        if (event.key === "Escape") setSelection(null);
      }}>
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
              alt={t("tracker.worldMap")}
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
                key={event.markerKey}
                className={`marker marker-${event.event_type || event.poi_type}${activeMarker?.markerKey === event.markerKey ? " marker-active" : ""}`}
                style={{ top: event.top, left: event.left }}
                title={event.title}
                aria-label={event.title}
                aria-expanded={activeMarker?.markerKey === event.markerKey}
                onClick={(e) => handleMarkerClick(e, event)}
              />
            ))}
          </div>
        </div>
        {activeMarker && (
          <div
            className={`marker-popup${activeMarker.latitude * zoom < 35 ? " marker-popup-below" : ""}`}
            style={{
              left: `clamp(var(--popup-half-width), calc(${activeMarker.longitude * zoom}% + ${pan.x}px), 100% - var(--popup-half-width))`,
              top: `clamp(0px, calc(${activeMarker.latitude * zoom}% + ${pan.y}px), 100%)`,
            }}
          >
            <div className="marker-popup-heading">
              <strong>{activeMarker.title}</strong>
              <button type="button" aria-label={t("tracker.closeMarker")} onClick={() => setSelection(null)}>
                ×
              </button>
            </div>
            <div className="marker-popup-content">
              <span className="marker-popup-type">{t(`tracker.${activeMarker.event_type || activeMarker.poi_type}`)}</span>
              {activeMarker.description && <p>{activeMarker.description}</p>}
              {activeMarker.image_path && (
                <img src={activeMarker.image_path} alt={activeMarker.title} className="marker-popup-image" />
              )}
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "0.5rem" }}>
        <small style={{ color: "#5d3a1a" }}>{t('tracker.legend')}</small>
        <button type="button" onClick={resetView} style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}>{t('tracker.resetView')}</button>
      </div>
    </div>
  );
}

// ===== MAIN APP =====
const views = ["tracker", "characters", "bestiary", "organizations", "npcs", "admin", "login", "register"];
const parseView = () => {
  const view = window.location.hash.replace(/^#\/?/, "");
  return views.includes(view) ? view : "tracker";
};

function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!supabase) return <main><p className="error">{t("auth.configurationMissing")}</p></main>;
  if (session === undefined) return <main><p role="status">{t("auth.loadingSession")}</p></main>;
  return <Campaign key={session?.user.id ?? "guest"} session={session} />;
}

function Campaign({ session }) {
  const [activeView, setActiveView] = useState(() => session && ["login", "register"].includes(parseView())
    ? "tracker"
    : parseView());
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const [operationError, setOperationError] = useState("");
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const handlePop = () => setActiveView(parseView());
    window.addEventListener("hashchange", handlePop);
    return () => window.removeEventListener("hashchange", handlePop);
  }, []);

  const navigate = (view) => {
    window.location.hash = view === "tracker" ? "" : `/${view}`;
    setActiveView(view);
  };

  const request = async (path, options) => {
    const mutation = options?.method && options.method !== "GET";
    if (mutation) {
      setOperationError("");
      setPending((count) => count + 1);
    }
    try {
      const response = await campaignRequest(path, options);
      if (!response.ok) setOperationError((await response.json()).detail);
      return response;
    } finally {
      if (mutation) setPending((count) => count - 1);
    }
  };

  const isAuthenticated = Boolean(session);
  const userId = session?.user.id;
  const [currentUser, setCurrentUser] = useState(null);
  const [pagePermissions, setPagePermissions] = useState({});
  const [loginData, setLoginData] = useState({ email: "", password: "" });
  const [registerData, setRegisterData] = useState({ username: "", email: "", password: "", confirmPassword: "" });
  const [loginError, setLoginError] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [registerNotice, setRegisterNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const hasPagePermission = (pageKey, requiredLevel = "view") =>
    hasLevel(pagePermissions[pageKey], requiredLevel);
  const canManageAdmin = hasPagePermission("admin", "admin");

  // Campaign/Public data
  const [events, refreshEvents] = useCampaignData("/events", hasPagePermission("tracker"), setOperationError);
  const [resources, refreshResources] = useCampaignData("/resources", hasPagePermission("tracker"), setOperationError);
  const [diaryEntries, refreshDiaryEntries] = useCampaignData("/diary", hasPagePermission("tracker"), setOperationError);
  const [creatures, refreshCreatures] = useCampaignData("/creatures", hasPagePermission("bestiary"), setOperationError);
  const [allies, refreshAllies] = useCampaignData("/allies", hasPagePermission("npcs"), setOperationError);
  const [maps, refreshMaps] = useCampaignData("/maps", hasPagePermission("tracker") || canManageAdmin, setOperationError);
  const hasTrackerMap = maps.length > 0;
  const [organizations, refreshOrganizations] = useCampaignData("/organizations", hasPagePermission("organizations"), setOperationError);
  const [orgDraft, setOrgDraft] = useState({ name: "", description: "" });
  const [orgImageFile, setOrgImageFile] = useState(null);
  const [selectedOrgRecord, setSelectedOrg] = useState(null);
  const selectedOrg = organizations.find((row) => row.id === selectedOrgRecord?.id) ?? null;
  const [selectedOrgImage, setSelectedOrgImage] = useState(null);
  const [orgError, setOrgError] = useState("");

  // Map state
  const [trackerMapRecord, setTrackerMap] = useState(null);
  const trackerMap = maps.find((row) => row.id === trackerMapRecord?.id) ?? null;
  const [trackerMapPOIs, setTrackerMapPOIs] = useState([]);   // tracker view

  // POI draft (pending placement)

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
  const [newUserData, setNewUserData] = useState({ username: "", email: "", password: "" });
  const [userManagementError, setUserManagementError] = useState("");
  const [passwordResetDrafts, setPasswordResetDrafts] = useState({});

  // User-specific data
  const [characters, refreshCharacters] = useCampaignData("/characters", hasPagePermission("characters"), setOperationError);
  const [companions] = useCampaignData("/character-companions",
    hasPagePermission("characters") && !currentUser?.is_admin, setOperationError);
  const [selectedCharacterRecord, setSelectedCharacter] = useState(null);
  const selectedCharacter = characters.find((row) => row.id === selectedCharacterRecord?.id) ?? null;
  const ownsSelectedCharacter = selectedCharacter?.user_id === currentUser?.id;
  const canEditSelectedCharacter = ownsSelectedCharacter && hasPagePermission("characters", "edit");
  const [characterInventory, setCharacterInventory] = useState([]);
  const [characterDiary, setCharacterDiary] = useState({ loading: true, entries: [] });

  // Form drafts
  const [resourceDraft, setResourceDraft] = useState({ name: "", quantity: 0, notes: "" });
  const [resourceImageFile, setResourceImageFile] = useState(null);
  const [selectedResourceImage, setSelectedResourceImage] = useState(null); // URL string for lightbox
  const [diaryDraft, setDiaryDraft] = useState({ title: "", content: "" });
  const [diaryImageFile, setDiaryImageFile] = useState(null);
  const [selectedDiaryImage, setSelectedDiaryImage] = useState(null);
  const [characterDraft, setCharacterDraft] = useState(blankCharacter);
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

  // Auth changes remount this component on account changes, clearing private data.
  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    let version = 0;
    const refreshProfile = async () => {
      const requestVersion = ++version;
      try {
        const profile = await readProfile(userId);
        if (!mounted || requestVersion !== version) return;
        setCurrentUser(profile);
        setPagePermissions(Object.fromEntries(
          profile.permissions.map(({ page_key, permission_level }) => [page_key, permission_level]),
        ));
      } catch (error) {
        if (mounted && requestVersion === version) setOperationError(error.message);
      }
    };
    refreshProfile();
    window.addEventListener("focus", refreshProfile);
    const timer = setInterval(refreshProfile, 60_000);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener("focus", refreshProfile);
    };
  }, [userId]);

  const login = async (event) => {
    event.preventDefault();
    setLoginError("");
    setAuthBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginData.email.trim(),
        password: loginData.password,
      });
      if (error) setLoginError(error.message);
      else navigate("tracker");
    } finally {
      setAuthBusy(false);
    }
  };

  const register = async (event) => {
    event.preventDefault();
    setRegisterError("");
    if (registerData.password !== registerData.confirmPassword) {
      setRegisterError(t("auth.passwordMismatch"));
      return;
    }
    if (registerData.password.length < 8) {
      setRegisterError(t("auth.passwordTooShort"));
      return;
    }

    setAuthBusy(true);
    try {
      const email = registerData.email.trim();
      const { data, error } = await supabase.auth.signUp({
        email,
        password: registerData.password,
        options: {
          data: { username: registerData.username.trim() },
          emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
        },
      });
      if (error) {
        setRegisterError(error.message);
        return;
      }
      setRegisterData({ username: "", email: "", password: "", confirmPassword: "" });
      setLoginData({ email, password: "" });
      if (!data.session) setRegisterNotice(t("auth.confirmEmail"));
      navigate(data.session ? "tracker" : "login");
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) setOperationError(error.message);
    else navigate("tracker");
  };

  useEffect(() => {
    const requiredPermissions = {
      tracker: ["tracker", "view"],
      characters: ["characters", "view"],
      bestiary: ["bestiary", "view"],
      organizations: ["organizations", "view"],
      npcs: ["npcs", "view"],
      admin: ["admin", "admin"],
    };

    if (["login", "register"].includes(activeView)) {
      if (isAuthenticated) navigate("tracker");
      return;
    }
    if (isAuthenticated && !currentUser) return;

    if (!isAuthenticated) {
      if (activeView !== "tracker") {
        navigate("login");
      }
      return;
    }

    const config = requiredPermissions[activeView];
    if (!config) {
      return;
    }

    const [pageKey, level] = config;
    if (!hasPagePermission(pageKey, level)) {
      navigate("tracker");
    }
  }, [activeView, isAuthenticated, currentUser, pagePermissions]);

  // Campaign: Delete Event
  const deleteEvent = async (id) => {
    await request(`/events/${id}`, {
      method: "DELETE",
    });
    refreshEvents();
  };

  // Resources: Submit Resource
  const submitResource = async (event) => {
    event.preventDefault();
    const response = await request(`/resources`, {
      method: "POST",
      body: { ...resourceDraft, quantity: Number(resourceDraft.quantity) },
    });
    if (response.ok) {
      const created = await response.json();
      if (resourceImageFile) {
        const fd = new FormData();
        fd.append("file", resourceImageFile);
        await request(`/resources/${created.id}/image`, {
          method: "POST",
          body: fd,
        });
        setResourceImageFile(null);
      }
      setResourceError("");
      setResourceDraft({ name: "", quantity: 0, notes: "" });
      refreshResources();
      return;
    }
    if (response.status === 401) {
      logout();
      setResourceError(t('auth.sessionExpired'));
      return;
    }
    setResourceError(await readErrorMessage(response, t('resources.createError')));
  };

  // Diary: Submit Diary Entry
  const submitDiary = async (event) => {
    event.preventDefault();
    const response = await request(`/diary`, {
      method: "POST",
      body: diaryDraft,
    });
    if (response.ok) {
      const created = await response.json();
      if (diaryImageFile) {
        const fd = new FormData();
        fd.append("file", diaryImageFile);
        await request(`/diary/${created.id}/image`, {
          method: "POST",
          body: fd,
        });
        setDiaryImageFile(null);
      }
      setDiaryError("");
      setDiaryDraft({ title: "", content: "" });
      refreshDiaryEntries();
      return;
    }
    if (response.status === 401) {
      logout();
      setDiaryError(t('auth.sessionExpired'));
      return;
    }
    setDiaryError(await readErrorMessage(response, t('diary.createError')));
  };

  // Characters: Submit Character
  const submitCharacter = async (event) => {
    event.preventDefault();
    const response = await request(`/characters`, {
      method: "POST",
      body: characterDraft,
    });
    if (response.ok) {
      const created = await response.json();
      if (characterImageFile) {
        const fd = new FormData();
        fd.append("file", characterImageFile);
        await request(`/characters/${created.id}/image`, {
          method: "POST",
          body: fd,
        });
        setCharacterImageFile(null);
      }
      setCharacterError("");
      setCharacterDraft(blankCharacter());
      refreshCharacters();
      return;
    }
    setCharacterError(await readErrorMessage(response, t('characters.createError')));
  };

  const saveCharacterSheet = async (characterId, draft) => {
    const result = await request(`/characters/${characterId}`, { method: "PUT", body: draft });
    if (result.ok) await refreshCharacters();
    return result.ok;
  };

  const uploadCharacterImage = async (characterId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    const response = await request(`/characters/${characterId}/image`, {
      method: "POST",
      body: fd,
    });
    if (response.ok) refreshCharacters();
  };

  // Characters: Upload Sheet
  const uploadCharacterSheet = async (characterId, file) => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await request(`/characters/${characterId}/upload-sheet`, {
      method: "POST",
      body: formData,
    });

    if (response.ok) {
      refreshCharacters();
      alert(t('characters.sheetUploaded'));
    } else {
      alert(t('characters.sheetUploadFailed'));
    }
  };

  // Characters: Delete Character
  const deleteCharacter = async (id) => {
    if (!confirm(t('characters.deleteConfirm'))) return;
    await request(`/characters/${id}`, {
      method: "DELETE",
    });
    refreshCharacters();
    if (selectedCharacter?.id === id) {
      setSelectedCharacter(null);
    }
  };

  const characterDetailRequest = useRef(0);
  const loadCharacterDetails = async (character) => {
    const requestId = ++characterDetailRequest.current;
    setSelectedCharacter(character);
    setCharacterInventory([]);
    setCharacterDiary({ loading: true, entries: [] });

    const ownsCharacter = character.user_id === currentUser?.id;
    const [inventoryResponse, diaryResponse] = await Promise.all([
      ownsCharacter ? request(`/characters/${character.id}/inventory`) : null,
      request(`/characters/${character.id}/diary`),
    ]);
    const [inventory, diary] = await Promise.all([
      inventoryResponse?.ok ? inventoryResponse.json() : [],
      diaryResponse.ok ? diaryResponse.json() : [],
    ]);
    if (requestId !== characterDetailRequest.current) return;
    setCharacterInventory(inventory);
    setCharacterDiary({ loading: false, entries: diary, failed: !diaryResponse.ok });
  };

  // Character Inventory: Add Item
  const addInventoryItem = async (event) => {
    event.preventDefault();
    if (!selectedCharacter) return;

    const response = await request(`/characters/${selectedCharacter.id}/inventory`, {
      method: "POST",
      body: { ...inventoryDraft, character_id: selectedCharacter.id },
    });

    if (response.ok) {
      setInventoryDraft({ item_name: "", quantity: 1, description: "" });
      loadCharacterDetails(selectedCharacter);
    }
  };

  // Character Inventory: Delete Item
  const deleteInventoryItem = async (itemId) => {
    await request(`/inventory/${itemId}`, {
      method: "DELETE",
    });
    loadCharacterDetails(selectedCharacter);
  };

  // Character Diary: Add Entry
  const addCharacterDiaryEntry = async (event) => {
    event.preventDefault();
    if (!selectedCharacter) return;

    const response = await request(`/characters/${selectedCharacter.id}/diary`, {
      method: "POST",
      body: { ...charDiaryDraft, character_id: selectedCharacter.id },
    });

    if (response.ok) {
      setCharDiaryDraft({ title: "", content: "" });
      loadCharacterDetails(selectedCharacter);
    }
  };

  // Bestiary: Submit Creature
  const submitCreature = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await request(`/creatures`, {
      method: "POST",
      body: creatureDraft,
    });
    if (response.ok) {
      const created = await response.json();
      if (creatureImageFile) {
        const fd = new FormData();
        fd.append("file", creatureImageFile);
        await request(`/creatures/${created.id}/image`, {
          method: "POST",
          body: fd,
        });
        setCreatureImageFile(null);
      }
      form.reset();
      setCreatureError("");
      setCreatureDraft({ name: "", creature_type: "", challenge_rating: "", armor_class: 0, hit_points: "", speed: "", abilities: "", weaknesses: "", resistances: "", immunities: "", notes: "" });
      refreshCreatures();
      return;
    }
    setCreatureError(await readErrorMessage(response, t("bestiary.createError")));
  };

  // Bestiary: Delete Creature
  const deleteCreature = async (id) => {
    await request(`/creatures/${id}`, {
      method: "DELETE",
    });
    refreshCreatures();
  };

  // Allies: Submit Ally
  const submitAlly = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await request(`/allies`, {
      method: "POST",
      body: allyDraft,
    });
    if (response.ok) {
      const created = await response.json();
      if (allyImageFile) {
        const fd = new FormData();
        fd.append("file", allyImageFile);
        await request(`/allies/${created.id}/image`, {
          method: "POST",
          body: fd,
        });
        setAllyImageFile(null);
      }
      form.reset();
      setAllyError("");
      setAllyDraft({ name: "", role: "", location: "", relationship: "", notes: "", organization_id: null });
      refreshAllies();
      return;
    }
    setAllyError(await readErrorMessage(response, t("npcs.createError")));
  };

  // Allies: Delete Ally
  const deleteAlly = async (id) => {
    await request(`/allies/${id}`, {
      method: "DELETE",
    });
    refreshAllies();
  };

  const uploadAllyImage = async (allyId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    await request(`/allies/${allyId}/image`, {
      method: "POST",
      body: fd,
    });
    refreshAllies();
  };

  const setAllyAlignment = async (allyId, alignment) => {
    await request(`/allies/${allyId}/alignment?alignment=${alignment}`, {
      method: "PATCH",
    });
    refreshAllies();
  };

  const uploadCreatureImage = async (creatureId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    await request(`/creatures/${creatureId}/image`, {
      method: "POST",
      body: fd,
    });
    refreshCreatures();
  };

  const uploadDiaryImage = async (entryId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    await request(`/diary/${entryId}/image`, {
      method: "POST",
      body: fd,
    });
    refreshDiaryEntries();
  };

  const submitOrganization = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const res = await request(`/organizations`, {
      method: "POST",
      body: orgDraft,
    });
    if (res.ok) {
      const created = await res.json();
      if (orgImageFile) {
        const fd = new FormData();
        fd.append("file", orgImageFile);
        await request(`/organizations/${created.id}/image`, {
          method: "POST",
          body: fd,
        });
        setOrgImageFile(null);
      }
      setOrgDraft({ name: "", description: "" });
      form.reset();
      setOrgError("");
      refreshOrganizations();
    } else {
      setOrgError(await readErrorMessage(res, t("organizations.createError")));
    }
  };

  const deleteOrganization = async (id) => {
    await request(`/organizations/${id}`, { method: "DELETE" });
    if (selectedOrg?.id === id) setSelectedOrg(null);
    refreshOrganizations();
  };

  const uploadOrganizationImage = async (orgId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    await request(`/organizations/${orgId}/image`, {
      method: "POST",
      body: fd,
    });
    refreshOrganizations();
  };

  // Maps: Upload Map
  const uploadMap = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const response = await request(`/maps`, {
      method: "POST",
      body: formData,
    });

    if (response.ok) {
      form.reset();
      refreshMaps();
      alert(t("admin.mapUploaded"));
    } else {
      alert(t("admin.mapUploadFailed"));
    }
  };

  // Maps: Delete Map
  const deleteMap = async (id) => {
    if (!confirm(t("admin.deleteMapConfirm"))) return;
    await request(`/maps/${id}`, {
      method: "DELETE",
    });
    refreshMaps();
  };

  // Maps: Load POIs for tracker view
  const loadTrackerMapPOIs = async (mapId) => {
    try {
      const response = await request(`/maps/${mapId}/pois`);
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

  const uploadMarkerImage = async (type, id, file) => {
    const formData = new FormData();
    formData.append("file", file);
    await request(`/${type}/${id}/image`, {
      method: "POST",
      body: formData,
    });
  };

  useEffect(() => {
    const refreshMapDetails = () => {
      if (!hasPagePermission("tracker")) return;
      if (trackerMap) loadTrackerMapPOIs(trackerMap.id);

      };
    window.addEventListener("focus", refreshMapDetails);
    const timer = setInterval(refreshMapDetails, 12 * 60 * 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshMapDetails);
    };
  }, [trackerMap?.id, pagePermissions.tracker]);

  // Tracker: submit unified marker (POI or event)
  const submitTrackerMarker = async (e) => {
    e.preventDefault();
    if (!trackerMarkerDraft || !trackerMap) return;
    const { title, description, kind, poi_type, event_type } = trackerMarkerForm;

    let newId = null;
    if (kind === "poi") {
      const res = await request(`/pois`, {
        method: "POST",
        body: { map_id: trackerMap.id, title, description, poi_type, latitude: trackerMarkerDraft.latitude, longitude: trackerMarkerDraft.longitude },
      });
      if (res.ok) { const d = await res.json(); newId = d.id; loadTrackerMapPOIs(trackerMap.id); }
    } else {
      const res = await request(`/events`, {
        method: "POST",
        body: { map_id: trackerMap.id, title, description, event_type, latitude: trackerMarkerDraft.latitude, longitude: trackerMarkerDraft.longitude },
      });
      if (res.ok) { const d = await res.json(); newId = d.id; refreshEvents(); }
    }

    if (!newId) return;
    if (trackerMarkerImageFile) {
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
    await request(`/pois/${poiId}`, { method: "DELETE" });
    if (trackerMap) loadTrackerMapPOIs(trackerMap.id);
  };

  const updatePOI = async (e) => {
    e.preventDefault();
    if (!editingPoi) return;
    const { id, title, description, poi_type } = editingPoi;
    const res = await request(`/pois/${id}`, {
      method: "PUT",
      body: { title, description, poi_type },
    });
    if (res.ok) {
      if (editingPoiImageFile) {
        await uploadMarkerImage("pois", id, editingPoiImageFile);
        setEditingPoiImageFile(null);
      }
      setEditingPoi(null);
      if (trackerMap) loadTrackerMapPOIs(trackerMap.id);

    }
  };

  const updateEvent = async (e) => {
    e.preventDefault();
    if (!editingEvent) return;
    const { id, title, description, event_type, latitude, longitude, map_id } = editingEvent;
    const res = await request(`/events/${id}`, {
      method: "PUT",
      body: { title, description, event_type, latitude, longitude, map_id },
    });
    if (res.ok) {
      if (editingEventImageFile) {
        await uploadMarkerImage("events", id, editingEventImageFile);
        setEditingEventImageFile(null);
      }
      setEditingEvent(null);
      refreshEvents();
    }
  };

  // Diary: delete entry
  const deleteDiaryEntry = async (id) => {
    await request(`/diary/${id}`, { method: "DELETE" });
    refreshDiaryEntries();
  };

  // Resources: delete resource
  const deleteResource = async (id) => {
    await request(`/resources/${id}`, { method: "DELETE" });
    refreshResources();
  };

  const uploadResourceImage = async (resourceId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    await request(`/resources/${resourceId}/image`, {
      method: "POST",
      body: fd,
    });
    refreshResources();
  };

  // Users: Load all users (admin only)
  const loadUsers = async () => {
    const response = await request(`/users`, {
    });
    if (response.ok) {
      setUsers(await response.json());
      return;
    }
    setUserManagementError(await readErrorMessage(response, t('admin.loadUsersError')));
  };

  const createUser = async (event) => {
    event.preventDefault();
    setUserManagementError("");
    const response = await request(`/users`, {
      method: "POST",
      body: newUserData,
    });

    if (response.ok) {
      setNewUserData({ username: "", email: "", password: "" });
      loadUsers();
      return;
    }
    setUserManagementError(await readErrorMessage(response, t('admin.createUserError')));
  };

  const updatePermission = async (userId, pageKey, permissionLevel) => {
    const response = await request(`/users/${userId}/permissions/${pageKey}`, {
      method: "PUT",
      body: { permission_level: permissionLevel },
    });

    if (response.ok) {
      const updatedPermission = await response.json();
      setUsers((currentUsers) => currentUsers.map((user) => {
        if (user.id !== userId) {
          return user;
        }

        return {
          ...user,
          permissions: (user.permissions ?? []).map((permission) => (
            permission.page_key === pageKey ? updatedPermission : permission
          )),
        };
      }));

      if (currentUser?.id === userId) {
        const nextPermissions = { ...pagePermissions, [pageKey]: permissionLevel };
        setPagePermissions(nextPermissions);
      }
      return;
    }

    setUserManagementError(await readErrorMessage(response, t('admin.updatePermissionError')));
  };

  const resetUserPassword = async (userId) => {
    const password = passwordResetDrafts[userId] ?? "";
    if (!password) {
      return;
    }

    const response = await request(`/users/${userId}/password`, {
      method: "PUT",
      body: { password },
    });

    if (response.ok) {
      setPasswordResetDrafts((drafts) => ({ ...drafts, [userId]: "" }));
      return;
    }

    setUserManagementError(await readErrorMessage(response, t('admin.resetPasswordError')));
  };

  return (
    <main>
      <header>
        <div className="campaign-brand">
          <img className="campaign-logo" src={`${import.meta.env.BASE_URL}d20.png`} width="64" height="64" alt="" />
          <h1>{t('app.title')}<span>{t('app.subtitle')}</span></h1>
        </div>
        <div className="tabs">
          <LanguagePicker />
          {(!isAuthenticated || hasPagePermission("tracker", "view") || canManageAdmin) && (
            <button type="button" onClick={() => navigate("tracker")} className={activeView === "tracker" ? "active" : ""}>
              {t('nav.chronicle')}
            </button>
          )}
          {isAuthenticated && (
            <>
              {hasPagePermission("characters", "view") && (
                <button type="button" onClick={() => navigate("characters")} className={activeView === "characters" ? "active" : ""}>
                  {t('nav.characters')}
                </button>
              )}
              {hasPagePermission("bestiary", "view") && (
                <button type="button" onClick={() => navigate("bestiary")} className={activeView === "bestiary" ? "active" : ""}>
                  {t('nav.bestiary')}
                </button>
              )}
              {hasPagePermission("organizations", "view") && (
                <button type="button" onClick={() => navigate("organizations")} className={activeView === "organizations" ? "active" : ""}>{t('nav.organizations')}</button>
              )}
              {hasPagePermission("npcs", "view") && (
                <button type="button" onClick={() => navigate("npcs")} className={activeView === "npcs" ? "active" : ""}>
                  {t('nav.npcs')}
                </button>
              )}
              {hasPagePermission("admin", "admin") && (
                <button type="button" onClick={() => navigate("admin")} className={activeView === "admin" ? "active" : ""}>
                  {t('nav.admin')}
                </button>
              )}
            </>
          )}
          {!isAuthenticated && (
            <>
              <button type="button" onClick={() => navigate("login")} className={activeView === "login" ? "active" : ""}>
                {t('nav.login')}
              </button>
              <button type="button" onClick={() => navigate("register")} className={activeView === "register" ? "active" : ""}>
                {t('nav.register')}
              </button>
            </>
          )}
          {isAuthenticated && (
            <button type="button" onClick={logout}>
              {t('nav.logout')}
            </button>
          )}
        </div>
      </header>
      {operationError && <p className="error" role="alert">{operationError}</p>}
      {(pending > 0 || (isAuthenticated && !currentUser && !operationError)) &&
        <p role="status">{t("common.loading")}</p>}

      {/* LOGIN VIEW */}
      {activeView === "login" && !isAuthenticated ? (
        <section className="grid">
          <article className="card">
            <h2>{t('auth.login')}</h2>
            <form onSubmit={login} className="form">
              <input
                type="email"
                autoComplete="email"
                value={loginData.email}
                onChange={(event) => setLoginData((old) => ({ ...old, email: event.target.value }))}
                placeholder={t("auth.email")}
                required
              />
              <input
                type="password"
                value={loginData.password}
                onChange={(event) => setLoginData((old) => ({ ...old, password: event.target.value }))}
                placeholder={t('auth.password')}
                required
              />
              <button type="submit" disabled={authBusy}>{t('auth.login')}</button>
            </form>
            {registerNotice && <p role="status">{registerNotice}</p>}
            {loginError ? <p className="error">{loginError}</p> : null}
            <p>
              <small>
                {t('auth.noAccount')}{" "}
                <button type="button" onClick={() => navigate("register")} style={{ background: "none", border: "none", color: "#8b4513", textDecoration: "underline", cursor: "pointer" }}>
                  {t('auth.registerHere')}
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
            <h2>{t('auth.register')}</h2>
            <form onSubmit={register} className="form">
              <input
                value={registerData.username}
                onChange={(event) => setRegisterData((old) => ({ ...old, username: event.target.value }))}
                placeholder={t('auth.usernamePlaceholder')}
                minLength={3}
                required
              />
              <input
                type="email"
                value={registerData.email}
                onChange={(event) => setRegisterData((old) => ({ ...old, email: event.target.value }))}
                placeholder={t("auth.email")}
                required
              />
              <input
                type="password"
                value={registerData.password}
                onChange={(event) => setRegisterData((old) => ({ ...old, password: event.target.value }))}
                placeholder={t('auth.passwordPlaceholder')}
                minLength={8}
                required
              />
              <input
                type="password"
                value={registerData.confirmPassword}
                onChange={(event) => setRegisterData((old) => ({ ...old, confirmPassword: event.target.value }))}
                placeholder={t('auth.confirmPassword')}
                required
              />
              <button type="submit" disabled={authBusy}>{t('auth.register')}</button>
            </form>
            {registerError ? <p className="error">{registerError}</p> : null}
            <p>
              <small>
                {t('auth.hasAccount')}{" "}
                <button type="button" onClick={() => navigate("login")} style={{ background: "none", border: "none", color: "#8b4513", textDecoration: "underline", cursor: "pointer" }}>
                  {t('auth.loginHere')}
                </button>
              </small>
            </p>
          </article>
        </section>
      ) : null}

      {/* TRACKER VIEW */}
      {activeView === "tracker" && canManageAdmin && (
        <section className="grid">
          <article className="card wide">
            <details className="character-sheet-panel">
              <summary>{t('admin.manageMaps')}</summary>
              <form onSubmit={uploadMap} className="form">
                <input name="name" placeholder={t('admin.mapName')} required />
                <input name="description" placeholder={t('common.description')} />
                <input name="file" type="file" accept="image/*" required />
                <button type="submit">{t('admin.uploadMapBtn')}</button>
              </form>

              <h3>{t('admin.uploadedMaps')}</h3>
              <ul>
                {maps.map((map) => (
                  <li key={map.id} className="row">
                    <span>
                      <strong>{map.name}</strong> {map.description && `- ${map.description}`}
                    </span>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button type="button" onClick={() => deleteMap(map.id)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          </article>
        </section>
      )}

      {activeView === "tracker" && (!isAuthenticated || hasPagePermission("tracker")) ? (
        <section className="grid">
          <article className="card wide">
            {!hasTrackerMap ? (
              <div
                style={{
                  padding: "2rem 1rem",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    maxWidth: "36rem",
                    width: "100%",
                    padding: "1.5rem 1.25rem",
                    textAlign: "center",
                    background: "linear-gradient(180deg, #fbf1df 0%, #f2dfbe 100%)",
                    border: "2px solid #8b4513",
                    borderRadius: "10px",
                    boxShadow: "0 10px 24px rgba(77, 46, 18, 0.16)",
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🗺️</div>
                  <h2 style={{ margin: "0 0 0.75rem", color: "#5d2f12" }}>{t('tracker.noMapTitle')}</h2>
                  <p style={{ margin: "0 0 0.5rem", color: "#5d3a1a", lineHeight: 1.5 }}>{t('tracker.noMapMessage')}</p>
                  <p style={{ margin: 0, color: "#7a5a33", lineHeight: 1.5 }}>
                    {canManageAdmin ? t('tracker.noMapAdminHint') : t('tracker.noMapUserHint')}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <h2 style={{ margin: 0 }}>
                    {trackerMap ? trackerMap.name : t('tracker.worldMap')}
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
                {hasPagePermission("tracker", "edit") && <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", color: "#5d3a1a" }}>{t('tracker.clickToPlace')}</p>}
                <MapView
                  mapId={trackerMap?.id}
                  events={[...events.filter((e) => e.map_id === (trackerMap?.id ?? null)), ...trackerMapPOIs]}
                  onMapClick={hasPagePermission("tracker", "edit") ? (coords) => { setTrackerMarkerDraft(coords); setTrackerMarkerForm({ title: "", description: "", kind: "poi", poi_type: "location", event_type: "event" }); } : undefined}
                  mapImageUrl={trackerMap ? trackerMap.file_path : null}
                  tempMarker={trackerMarkerDraft}
                />

                {hasPagePermission("tracker", "edit") && trackerMarkerDraft && (
                  <form onSubmit={submitTrackerMarker} className="form" style={{ marginTop: "1rem", padding: "1rem", background: "#f9f0e0", border: "2px solid #8b4513", borderRadius: "4px" }}>
                    <p style={{ margin: 0 }}><strong>{t('tracker.newMarker')}</strong> {t('tracker.at')} {trackerMarkerDraft.latitude.toFixed(1)}%, {trackerMarkerDraft.longitude.toFixed(1)}%</p>
                    <input
                      value={trackerMarkerForm.title}
                      onChange={(e) => setTrackerMarkerForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder={t('common.title')}
                      required
                    />
                    <input
                      value={trackerMarkerForm.description}
                      onChange={(e) => setTrackerMarkerForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder={t('common.descriptionOptional')}
                    />
                    <select value={trackerMarkerForm.kind} onChange={(e) => setTrackerMarkerForm((f) => ({ ...f, kind: e.target.value }))}>
                      <option value="poi">{t('tracker.poi')}</option>
                      <option value="event">{t('tracker.eventMarker')}</option>
                    </select>
                    {trackerMarkerForm.kind === "poi" ? (
                      <select value={trackerMarkerForm.poi_type} onChange={(e) => setTrackerMarkerForm((f) => ({ ...f, poi_type: e.target.value }))}>
                        <option value="location">{t('tracker.location')}</option>
                        <option value="city">{t('tracker.city')}</option>
                        <option value="dungeon">{t('tracker.dungeon')}</option>
                        <option value="landmark">{t('tracker.landmark')}</option>
                        <option value="quest">{t('tracker.quest')}</option>
                      </select>
                    ) : (
                      <select value={trackerMarkerForm.event_type} onChange={(e) => setTrackerMarkerForm((f) => ({ ...f, event_type: e.target.value }))}>
                        <option value="event">{t('tracker.event')}</option>
                        <option value="quest">{t('tracker.quest')}</option>
                      </select>
                    )}
                    <label style={{ fontSize: "0.9rem" }}>{t('common.imageOptional')}:
                      <input type="file" accept="image/*" style={{ marginLeft: "0.5rem" }} onChange={(e) => setTrackerMarkerImageFile(e.target.files[0] || null)} />
                    </label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button type="submit">{t('tracker.addMarker')}</button>
                      <button type="button" onClick={() => setTrackerMarkerDraft(null)}>{t('common.cancel')}</button>
                    </div>
                  </form>
                )}

                {hasPagePermission("tracker", "edit") && trackerMap && (trackerMapPOIs.length > 0 || events.filter((e) => e.map_id === trackerMap.id).length > 0) && (
                  <details style={{ marginTop: "1rem" }}>
                    <summary style={{ cursor: "pointer", color: "#5d3a1a", fontWeight: "bold" }}>{t('tracker.manageMarkers')}</summary>
                    <ul style={{ marginTop: "0.5rem" }}>
                      {trackerMapPOIs.map((poi) => (
                        <li key={`poi-${poi.id}`}>
                          {editingPoi?.id === poi.id ? (
                            <form onSubmit={updatePOI} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                              <input value={editingPoi.title} onChange={(e) => setEditingPoi((p) => ({ ...p, title: e.target.value }))} required style={{ flex: "1 1 120px" }} />
                              <input value={editingPoi.description} onChange={(e) => setEditingPoi((p) => ({ ...p, description: e.target.value }))} placeholder={t('common.description')} style={{ flex: "1 1 120px" }} />
                              <select value={editingPoi.poi_type} onChange={(e) => setEditingPoi((p) => ({ ...p, poi_type: e.target.value }))}>
                                <option value="location">{t('tracker.location')}</option>
                                <option value="city">{t('tracker.city')}</option>
                                <option value="dungeon">{t('tracker.dungeon')}</option>
                                <option value="landmark">{t('tracker.landmark')}</option>
                                <option value="quest">{t('tracker.quest')}</option>
                              </select>
                              <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
                                🖼️ {editingPoi.image_path ? t('common.replaceImage') : t('common.addImage')}
                                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setEditingPoiImageFile(e.target.files[0] || null)} />
                              </label>
                              {editingPoiImageFile && <small style={{ color: "#5d3a1a" }}>{editingPoiImageFile.name}</small>}
                              <button type="submit">{t('common.save')}</button>
                              <button type="button" onClick={() => { setEditingPoi(null); setEditingPoiImageFile(null); }}>{t('common.cancel')}</button>
                            </form>
                          ) : (
                            <div className="row">
                              <span><strong>{poi.title}</strong> ({poi.poi_type}){poi.description && ` — ${poi.description}`}</span>
                              <div style={{ display: "flex", gap: "0.25rem" }}>
                                <button type="button" onClick={() => setEditingPoi({ id: poi.id, title: poi.title, description: poi.description, poi_type: poi.poi_type })}>{t('common.edit')}</button>
                                <button type="button" onClick={() => deleteTrackerPOI(poi.id)}>{t('common.delete')}</button>
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
                              <input value={editingEvent.description} onChange={(e) => setEditingEvent((p) => ({ ...p, description: e.target.value }))} placeholder={t('common.description')} style={{ flex: "1 1 120px" }} />
                              <select value={editingEvent.event_type} onChange={(e) => setEditingEvent((p) => ({ ...p, event_type: e.target.value }))}>
                                <option value="event">{t('tracker.event')}</option>
                                <option value="quest">{t('tracker.quest')}</option>
                              </select>
                              <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
                                🖼️ {editingEvent.image_path ? t('common.replaceImage') : t('common.addImage')}
                                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setEditingEventImageFile(e.target.files[0] || null)} />
                              </label>
                              {editingEventImageFile && <small style={{ color: "#5d3a1a" }}>{editingEventImageFile.name}</small>}
                              <button type="submit">{t('common.save')}</button>
                              <button type="button" onClick={() => { setEditingEvent(null); setEditingEventImageFile(null); }}>{t('common.cancel')}</button>
                            </form>
                          ) : (
                            <div className="row">
                              <span><strong>{ev.title}</strong> ({ev.event_type})</span>
                              <div style={{ display: "flex", gap: "0.25rem" }}>
                                <button type="button" onClick={() => setEditingEvent({ id: ev.id, title: ev.title, description: ev.description, event_type: ev.event_type, latitude: ev.latitude, longitude: ev.longitude, map_id: ev.map_id, image_path: ev.image_path })}>{t('common.edit')}</button>
                                <button type="button" onClick={() => deleteEvent(ev.id)}>{t('common.delete')}</button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </article>

          <article className="card">
            <h2>{t('resources.title')}</h2>
            {hasPagePermission("tracker", "edit") && (
              <form onSubmit={submitResource} className="form" style={{ marginBottom: "1rem" }}>
                <input
                  value={resourceDraft.name}
                  onChange={(e) => setResourceDraft((old) => ({ ...old, name: e.target.value }))}
                  placeholder={t('resources.namePlaceholder')}
                  required
                />
                <input
                  type="number"
                  min="0"
                  value={resourceDraft.quantity}
                  onChange={(e) => setResourceDraft((old) => ({ ...old, quantity: e.target.value }))}
                  placeholder={t('resources.quantity')}
                  required
                />
                <input
                  value={resourceDraft.notes}
                  onChange={(e) => setResourceDraft((old) => ({ ...old, notes: e.target.value }))}
                  placeholder={t('common.notes')}
                />
                <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                  {t('common.imageOptionalLabel')}
                  <input type="file" accept="image/*" style={{ marginLeft: "0.5rem" }} onChange={(e) => setResourceImageFile(e.target.files[0] || null)} />
                </label>
                {resourceImageFile && <small style={{ color: "#5d3a1a" }}>{resourceImageFile.name}</small>}
                <button type="submit">{t('resources.add')}</button>
                {resourceError ? <p className="error">{resourceError}</p> : null}
              </form>
            )}
            <ul>
              {resources.map((item) => (
                <li key={item.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0", borderBottom: "1px solid #e8d5b0", flexWrap: "wrap" }}>
                  {item.image_path ? (
                    <img
                      src={item.image_path}
                      alt={item.name}
                      onClick={() => setSelectedResourceImage(item.image_path)}
                      style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "4px", cursor: "pointer", border: "2px solid #8b4513" }}
                      title={t('common.clickToView')}
                    />
                  ) : hasPagePermission("tracker", "edit") ? (
                    <label style={{ fontSize: "0.8rem", cursor: "pointer", color: "#8b4513", whiteSpace: "nowrap" }} title={t('common.addImage')}>
                      🖼️
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadResourceImage(item.id, e.target.files[0]); }} />
                    </label>
                  ) : null}
                  <span style={{ flexGrow: 1 }}><strong>{item.name}</strong>: {item.quantity}{item.notes ? ` (${item.notes})` : ""}</span>
                  {hasPagePermission("tracker", "edit") && item.image_path && (
                    <label style={{ fontSize: "0.8rem", cursor: "pointer", color: "#8b4513" }} title={t('common.replaceImage')}>
                      🔄
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadResourceImage(item.id, e.target.files[0]); }} />
                    </label>
                  )}
                  {hasPagePermission("tracker", "edit") && <button type="button" onClick={() => deleteResource(item.id)}>{t('common.delete')}</button>}
                </li>
              ))}
            </ul>
          </article>

          {selectedResourceImage && (
            <div
              onClick={() => setSelectedResourceImage(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}
            >
              <img src={selectedResourceImage} alt={t("common.imageLabel")} style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
            </div>
          )}

          <article className="card">
            <h2>{t('diary.title')}</h2>
            {hasPagePermission("tracker", "edit") && (
              <form onSubmit={submitDiary} className="form" style={{ marginBottom: "1rem" }}>
                <input
                  value={diaryDraft.title}
                  onChange={(e) => setDiaryDraft((old) => ({ ...old, title: e.target.value }))}
                  placeholder={t('diary.entryTitle')}
                  required
                />
                <textarea
                  value={diaryDraft.content}
                  onChange={(e) => setDiaryDraft((old) => ({ ...old, content: e.target.value }))}
                  placeholder={t('diary.contentPlaceholder')}
                  rows={4}
                  required
                />
                <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                  {t('common.imageOptionalLabel')}
                  <input type="file" accept="image/*" style={{ marginLeft: "0.5rem" }} onChange={(e) => setDiaryImageFile(e.target.files[0] || null)} />
                </label>
                {diaryImageFile && <small style={{ color: "#5d3a1a" }}>{diaryImageFile.name}</small>}
                <button type="submit">{t('diary.add')}</button>
                {diaryError ? <p className="error">{diaryError}</p> : null}
              </form>
            )}
            <ul>
              {diaryEntries.map((entry) => (
                <li key={entry.id} style={{ borderBottom: "1px solid #e8d5b0", paddingBottom: "0.75rem", marginBottom: "0.75rem" }}>
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <strong>{entry.title}</strong>
                    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                      {hasPagePermission("tracker", "edit") && (
                        <label style={{ fontSize: "0.8rem", cursor: "pointer" }} title={entry.image_path ? t('common.replaceImage') : t('common.addImage')}>
                          🖼️
                          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadDiaryImage(entry.id, e.target.files[0]); }} />
                        </label>
                      )}
                      {hasPagePermission("tracker", "edit") && <button type="button" onClick={() => deleteDiaryEntry(entry.id)}>{t('common.delete')}</button>}
                    </div>
                  </div>
                  <p style={{ margin: "0.25rem 0" }}>{entry.content}</p>
                  {entry.image_path && (
                    <img
                      src={entry.image_path}
                      alt={entry.title}
                      onClick={() => setSelectedDiaryImage(entry.image_path)}
                      style={{ maxWidth: "100%", maxHeight: "200px", objectFit: "contain", borderRadius: "4px", cursor: "pointer", marginTop: "0.5rem", border: "1px solid #ddd" }}
                      title={t('common.clickToViewFull')}
                    />
                  )}
                </li>
              ))}
            </ul>
          </article>

          {selectedDiaryImage && (
            <div onClick={() => setSelectedDiaryImage(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
              <img src={selectedDiaryImage} alt={t("common.imageLabel")} style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
            </div>
          )}
        </section>
      ) : null}

      {/* CHARACTERS VIEW */}
      {activeView === "characters" && isAuthenticated && hasPagePermission("characters", "view") ? (
        <section className="grid">
          <article className="card wide">
            {!selectedCharacter && <h2>{t('characters.title')}</h2>}
            {!selectedCharacter ? (
              <>
                {hasPagePermission("characters", "edit") && (
                  <form onSubmit={submitCharacter} className="form">
                  <input
                    value={characterDraft.name}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, name: e.target.value }))}
                    placeholder={t('characters.namePlaceholder')}
                    required
                  />
                  <input
                    value={characterDraft.character_class}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, character_class: e.target.value }))}
                    placeholder={t('characters.class')}
                  />
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={characterDraft.level}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, level: Number(e.target.value) }))}
                    placeholder={t('characters.level')}
                  />
                  <input
                    value={characterDraft.race}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, race: e.target.value }))}
                    placeholder={t('characters.race')}
                  />
                  <textarea
                    value={characterDraft.notes}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, notes: e.target.value }))}
                    placeholder={t('common.notes')}
                    rows={3}
                  />
                  <select
                    value={characterDraft.organization_id ?? ""}
                    onChange={(e) => setCharacterDraft((old) => ({ ...old, organization_id: e.target.value ? Number(e.target.value) : null }))}
                  >
                    <option value="">{t('characters.noOrg')}</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                  <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                    🖼️ {characterImageFile ? characterImageFile.name : t('characters.addPortrait')}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setCharacterImageFile(e.target.files[0] || null)} />
                  </label>
                  <details className="character-sheet-panel">
                    <summary>{t("characterSheet.optionalDetails")}</summary>
                    <SheetFields draft={characterDraft}
                      onChange={(field, value) => setCharacterDraft((current) => ({ ...current, [field]: value }))} />
                  </details>
                  <button type="submit">{t('characters.create')}</button>
                  </form>
                )}
                {hasPagePermission("characters", "edit") && characterError ? <p className="error">{characterError}</p> : null}

                <h3>{t(currentUser?.is_admin ? 'characters.allCharacters' : 'characters.yourCharacters')}</h3>
                <ul>
                  {characters.map((char) => (
                    <li key={char.id} className="row" style={{ alignItems: "center", gap: "0.75rem" }}>
                      {char.image_path ? (
                        <img
                          src={char.image_path}
                          alt={char.name}
                          onClick={() => setSelectedCharacterImage(char.image_path)}
                          style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "50%", cursor: "pointer", border: "2px solid #8b4513", flexShrink: 0 }}
                          title={t('common.clickToView')}
                        />
                      ) : (
                        <span style={{ fontSize: "2rem", flexShrink: 0 }}>{char.emoji || defaultCharacterEmoji}</span>
                      )}
                      <span style={{ flexGrow: 1 }}>
                        {char.image_path && char.emoji && <span aria-hidden="true">{char.emoji} </span>}
                        <strong>{char.name}</strong> - {t('characters.lvl')} {char.level} {char.race} {char.character_class}
                        {currentUser?.is_admin && char.owner?.username && (
                          <small> · {t('characters.owner', { name: char.owner.username })}</small>
                        )}
                        {char.organization_id && organizations.find((o) => o.id === char.organization_id) && (
                          <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", background: "#8b4513", color: "#fff", borderRadius: "4px", padding: "1px 6px" }}>
                            {organizations.find((o) => o.id === char.organization_id).name}
                          </span>
                        )}
                      </span>
                      <div>
                        <button type="button" onClick={() => loadCharacterDetails(char)}>
                          {t('common.view')}
                        </button>
                        {char.sheet_file_path && (
                          <a href={char.sheet_file_path} target="_blank" rel="noreferrer">
                            <button type="button">{t('characters.sheet')}</button>
                          </a>
                        )}
                        {char.user_id === currentUser?.id && hasPagePermission("characters", "edit") && (
                          <button type="button" onClick={() => deleteCharacter(char.id)}>
                            {t('common.delete')}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {!currentUser?.is_admin && (
                  <section className="character-sheet-panel">
                    <div className="character-section-heading">
                      <h4>{t("characterSheet.companions")}</h4>
                    </div>
                    {companions.length ? (
                      <ul className="character-companion-grid">
                        {companions.map((companion) => (
                          <li key={companion.id}>
                            <span className="character-companion-emoji" aria-hidden="true">{companion.emoji || defaultCharacterEmoji}</span>
                            <div>
                              <strong>{companion.name}</strong>
                              <span>{[companion.race, companion.character_class, `${t("characters.lvl")} ${companion.level}`].filter(Boolean).join(" · ")}</span>
                              <small>{t("characters.owner", { name: companion.owner_name })}</small>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="character-sheet-empty">{t("characterSheet.noCompanions")}</p>}
                  </section>
                )}
              </>
            ) : (
              <div className="character-detail-layout">
                <button type="button" onClick={() => setSelectedCharacter(null)}>
                  {t('characters.back')}
                </button>
                <div className="character-profile-header">
                  <div style={{ flexShrink: 0 }}>
                    {selectedCharacter.image_path ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
                        <img
                          src={selectedCharacter.image_path}
                          alt={selectedCharacter.name}
                          onClick={() => setSelectedCharacterImage(selectedCharacter.image_path)}
                          style={{ width: "96px", height: "96px", objectFit: "cover", borderRadius: "50%", cursor: "pointer", border: "3px solid #8b4513" }}
                          title={t('common.clickToView')}
                        />
                        {canEditSelectedCharacter && (
                          <label style={{ fontSize: "0.8rem", cursor: "pointer", color: "#5d3a1a" }} title={t('common.replaceImage')}>
                            {t('common.replace')}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadCharacterImage(selectedCharacter.id, e.target.files[0]); }} />
                          </label>
                        )}
                      </div>
                    ) : (
                      canEditSelectedCharacter ? (
                        <label style={{ width: "96px", height: "96px", border: "2px dashed #8b4513", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexDirection: "column", gap: "0.25rem", fontSize: "0.75rem", color: "#5d3a1a" }} title={t('characters.addPortraitShort')}>
                          <span className="character-profile-emoji">{selectedCharacter.emoji || defaultCharacterEmoji}</span>
                          <span>{t('characters.addPortraitShort')}</span>
                          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadCharacterImage(selectedCharacter.id, e.target.files[0]); }} />
                        </label>
                      ) : (
                        <span style={{ width: "96px", height: "96px", borderRadius: "50%", border: "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2rem" }}>{selectedCharacter.emoji || defaultCharacterEmoji}</span>
                      )
                    )}
                  </div>
                  <div>
                    <h2 className="character-profile-name">
                      {selectedCharacter.image_path && selectedCharacter.emoji && <span aria-hidden="true">{selectedCharacter.emoji} </span>}
                      {selectedCharacter.name}
                    </h2>
                    <ul className="character-profile-stats">
                      {[`${t("characters.lvl")} ${selectedCharacter.level}`, selectedCharacter.race, selectedCharacter.character_class]
                        .filter(Boolean).map((stat, index) => <li key={index}>{stat}</li>)}
                    </ul>
                    {currentUser?.is_admin && selectedCharacter.owner?.username && (
                      <p className="character-profile-owner">{t('characters.owner', { name: selectedCharacter.owner.username })}</p>
                    )}
                    {selectedCharacter.organization_id && organizations.find((o) => o.id === selectedCharacter.organization_id) && (
                      <span style={{ fontSize: "0.85rem", background: "#8b4513", color: "#fff", borderRadius: "4px", padding: "2px 8px", display: "inline-block", marginBottom: "0.5rem" }}>
                        🏰 {organizations.find((o) => o.id === selectedCharacter.organization_id).name}
                      </span>
                    )}
                    {selectedCharacter.notes && <p style={{ margin: 0 }}>{selectedCharacter.notes}</p>}
                  </div>
                </div>

                <CharacterSheet key={selectedCharacter.id} character={selectedCharacter} editable={canEditSelectedCharacter}
                  onSave={(draft) => saveCharacterSheet(selectedCharacter.id, draft)} />

                {(ownsSelectedCharacter || currentUser?.is_admin) && (
                  <ImageGallery key={selectedCharacter.id} path={`/characters/${selectedCharacter.id}/gallery`}
                    editable={canEditSelectedCharacter} api={request} onView={setSelectedCharacterImage} />
                )}

                {canEditSelectedCharacter && (
                  <section className="character-sheet-panel">
                    <h4>{t('characters.uploadSheet')}</h4>
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={(e) => e.target.files[0] && uploadCharacterSheet(selectedCharacter.id, e.target.files[0])}
                    />
                  </section>
                )}

                {ownsSelectedCharacter && (
                  <section className="character-sheet-panel">
                    <h4>{t('characters.inventory')}</h4>
                    {canEditSelectedCharacter && (
                      <form onSubmit={addInventoryItem} className="form">
                      <input
                        value={inventoryDraft.item_name}
                        onChange={(e) => setInventoryDraft((old) => ({ ...old, item_name: e.target.value }))}
                        placeholder={t('characters.itemName')}
                        required
                      />
                      <input
                        type="number"
                        min="1"
                        value={inventoryDraft.quantity}
                        onChange={(e) => setInventoryDraft((old) => ({ ...old, quantity: Number(e.target.value) }))}
                        placeholder={t('resources.quantity')}
                      />
                      <input
                        value={inventoryDraft.description}
                        onChange={(e) => setInventoryDraft((old) => ({ ...old, description: e.target.value }))}
                        placeholder={t('common.description')}
                      />
                      <button type="submit">{t('characters.addItem')}</button>
                      </form>
                    )}
                    <ul>
                      {characterInventory.map((item) => (
                        <li key={item.id} className="row">
                          <span>
                            <strong>{item.item_name}</strong> x{item.quantity}
                            {item.description ? ` - ${item.description}` : ""}
                          </span>
                          {canEditSelectedCharacter && (
                            <button type="button" onClick={() => deleteInventoryItem(item.id)}>
                              {t('common.delete')}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="character-sheet-panel">
                  <h4>{t('characters.diary')}</h4>
                  {canEditSelectedCharacter && (
                    <form onSubmit={addCharacterDiaryEntry} className="form">
                    <input
                      value={charDiaryDraft.title}
                      onChange={(e) => setCharDiaryDraft((old) => ({ ...old, title: e.target.value }))}
                      placeholder={t('diary.entryTitle')}
                      required
                    />
                    <textarea
                      value={charDiaryDraft.content}
                      onChange={(e) => setCharDiaryDraft((old) => ({ ...old, content: e.target.value }))}
                      placeholder={t('characters.diaryPlaceholder')}
                      rows={4}
                      required
                    />
                    <button type="submit">{t('diary.add')}</button>
                    </form>
                  )}
                  {characterDiary.loading ? (
                    <p role="status" className="character-sheet-empty">{t("common.loading")}</p>
                  ) : characterDiary.failed ? (
                    <button type="button" onClick={() => loadCharacterDetails(selectedCharacter)}>{t("characterSheet.retryDiary")}</button>
                  ) : characterDiary.entries.length === 0 ? (
                    <p className="character-sheet-empty">{t("characterSheet.noDiaryEntries")}</p>
                  ) : (
                    <ul className="character-diary-entries">
                      {characterDiary.entries.map((entry) => (
                        <li key={entry.id}>
                          <strong>{entry.title}</strong>
                          <p>{entry.content}</p>
                          <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleDateString(lang)}</time>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </article>
        </section>
      ) : null}

      {/* BESTIARY VIEW */}
      {activeView === "bestiary" ? (
        <section className="grid">
          <article className="card wide">
            <h2>{t('bestiary.title')}</h2>
            {hasPagePermission("bestiary", "edit") && (
              <details className="character-sheet-panel">
                <summary>{t("admin.addCreature")}</summary>
                <form onSubmit={submitCreature} className="form">
                  <input
                    value={creatureDraft.name}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, name: e.target.value }))}
                    placeholder={t('admin.creatureName')}
                    required
                  />
                  <input
                    value={creatureDraft.creature_type}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, creature_type: e.target.value }))}
                    placeholder={t('admin.creatureTypePlaceholder')}
                  />
                  <input
                    value={creatureDraft.challenge_rating}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, challenge_rating: e.target.value }))}
                    placeholder={t('admin.challengeRating')}
                  />
                  <input
                    type="number"
                    value={creatureDraft.armor_class}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, armor_class: Number(e.target.value) }))}
                    placeholder={t('admin.armorClass')}
                  />
                  <input
                    value={creatureDraft.hit_points}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, hit_points: e.target.value }))}
                    placeholder={t('admin.hitPoints')}
                  />
                  <input
                    value={creatureDraft.speed}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, speed: e.target.value }))}
                    placeholder={t('admin.speedPlaceholder')}
                  />
                  <textarea
                    value={creatureDraft.abilities}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, abilities: e.target.value }))}
                    placeholder={t('admin.abilities')}
                    rows={2}
                  />
                  <textarea
                    value={creatureDraft.weaknesses}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, weaknesses: e.target.value }))}
                    placeholder={t('admin.weaknesses')}
                    rows={2}
                  />
                  <textarea
                    value={creatureDraft.resistances}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, resistances: e.target.value }))}
                    placeholder={t('admin.resistances')}
                    rows={2}
                  />
                  <textarea
                    value={creatureDraft.immunities}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, immunities: e.target.value }))}
                    placeholder={t('admin.immunities')}
                    rows={2}
                  />
                  <textarea
                    value={creatureDraft.notes}
                    onChange={(e) => setCreatureDraft((old) => ({ ...old, notes: e.target.value }))}
                    placeholder={t('common.notes')}
                    rows={3}
                  />
                  <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                    {t('common.imageOptionalLabel')}
                    <input type="file" accept="image/*" style={{ marginLeft: "0.5rem" }} onChange={(e) => setCreatureImageFile(e.target.files[0] || null)} />
                  </label>
                  {creatureImageFile && <small style={{ color: "#5d3a1a" }}>{creatureImageFile.name}</small>}
                  <button type="submit">{t('admin.addCreature')}</button>
                </form>
                {creatureError ? <p className="error">{creatureError}</p> : null}
              </details>
            )}
            <h3>{t('bestiary.encountered')}</h3>
            <ul>
              {creatures.map((creature) => (
                <li key={creature.id} style={{ marginBottom: "1rem", padding: "0.5rem", border: "1px solid #ddd", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                  {creature.image_path ? (
                    <img
                      src={creature.image_path}
                      alt={creature.name}
                      onClick={() => setSelectedCreatureImage(creature.image_path)}
                      style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "4px", cursor: "pointer", border: "2px solid #8b4513", flexShrink: 0 }}
                      title={t('common.clickToView')}
                    />
                  ) : hasPagePermission("bestiary", "edit") ? (
                    <label style={{ width: "64px", height: "64px", border: "2px dashed #8b4513", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontSize: "1.8rem" }} title={t('common.addImage')}>
                      🐉
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadCreatureImage(creature.id, e.target.files[0]); }} />
                    </label>
                  ) : (
                    <span style={{ fontSize: "2rem", flexShrink: 0 }}>🐉</span>
                  )}
                  <div className="campaign-entry-content">
                    <div className="row">
                      <strong>{creature.name}</strong>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        {hasPagePermission("bestiary", "edit") && creature.image_path && (
                          <label style={{ fontSize: "0.8rem", cursor: "pointer" }} title={t('common.replaceImage')}>
                            🔄
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadCreatureImage(creature.id, e.target.files[0]); }} />
                          </label>
                        )}
                        {hasPagePermission("bestiary", "edit") && (
                          <button type="button" onClick={() => deleteCreature(creature.id)}>{t('common.delete')}</button>
                        )}
                      </div>
                    </div>
                    {creature.creature_type && <p><strong>{t('bestiary.type')}</strong> {creature.creature_type}</p>}
                    {creature.challenge_rating && <p><strong>{t('bestiary.cr')}</strong> {creature.challenge_rating}</p>}
                    {creature.armor_class > 0 && <p><strong>{t('bestiary.ac')}</strong> {creature.armor_class}</p>}
                    {creature.hit_points && <p><strong>{t('bestiary.hp')}</strong> {creature.hit_points}</p>}
                    {creature.speed && <p><strong>{t('bestiary.speed')}</strong> {creature.speed}</p>}
                    {creature.abilities && <p><strong>{t('bestiary.abilities')}</strong> {creature.abilities}</p>}
                    {creature.weaknesses && <p><strong>{t('bestiary.weaknesses')}</strong> {creature.weaknesses}</p>}
                    {creature.resistances && <p><strong>{t('bestiary.resistances')}</strong> {creature.resistances}</p>}
                    {creature.immunities && <p><strong>{t('bestiary.immunities')}</strong> {creature.immunities}</p>}
                    {creature.notes && <p><strong>{t('bestiary.notesLabel')}</strong> {creature.notes}</p>}
                    <CampaignEntryTools collection="creatures" entry={creature}
                      editable={hasPagePermission("bestiary", "edit")} api={request}
                      refresh={refreshCreatures} onView={setSelectedCreatureImage} />
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </section>
      ) : null}

      {selectedCreatureImage && (
        <div onClick={() => setSelectedCreatureImage(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
          <img src={selectedCreatureImage} alt={t("common.imageLabel")} style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
        </div>
      )}

      {selectedCharacterImage && (
        <div onClick={() => setSelectedCharacterImage(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
          <img src={selectedCharacterImage} alt={t("common.imageLabel")} style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
        </div>
      )}

      {/* ORGANIZATIONS VIEW */}
      {activeView === "organizations" ? (
        <section style={{ padding: "1rem", maxWidth: "1200px", margin: "0 auto" }}>
          <div className="card wide">
            <h2>{t('organizations.title')}</h2>
            {hasPagePermission("organizations", "edit") && (
              <details className="character-sheet-panel">
                <summary>{t("admin.addOrg")}</summary>
                <form onSubmit={submitOrganization} className="form">
                  <input
                    value={orgDraft.name}
                    onChange={(e) => setOrgDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder={t('admin.orgNamePlaceholder')}
                    required
                  />
                  <input
                    value={orgDraft.description}
                    onChange={(e) => setOrgDraft((d) => ({ ...d, description: e.target.value }))}
                    placeholder={t('common.descriptionOptional')}
                  />
                  <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                    🖼️ {orgImageFile ? orgImageFile.name : t('common.addImageOptional')}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setOrgImageFile(e.target.files[0] || null)} />
                  </label>
                  <button type="submit">{t('admin.addOrgBtn')}</button>
                </form>
                {orgError ? <p className="error">{orgError}</p> : null}
              </details>
            )}

            {organizations.length === 0 && (
              <p style={{ textAlign: "center", marginTop: "1rem" }}>{t('organizations.empty')}</p>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
              {organizations.map((org) => {
                const memberCount = allies.filter((a) => a.organization_id === org.id).length;
                const isSelected = selectedOrg?.id === org.id;
                return (
                  <div
                    key={org.id}
                    onClick={() => setSelectedOrg(isSelected ? null : org)}
                    style={{
                      width: "220px",
                      border: `2px solid ${isSelected ? "var(--sienna)" : "var(--gold-dark)"}`,
                      borderRadius: "var(--border-radius)",
                      overflow: "hidden",
                      cursor: "pointer",
                      background: isSelected
                        ? "linear-gradient(160deg, #f9f0db 0%, #ecddb8 100%)"
                        : "linear-gradient(160deg, #fdf8ef 0%, #f5e9d0 100%)",
                      boxShadow: isSelected
                        ? "0 4px 16px rgba(107,45,15,0.35), 0 0 0 1px var(--gold)"
                        : "0 2px 8px rgba(0,0,0,0.25)",
                      transition: "box-shadow 0.15s, border-color 0.15s",
                    }}
                  >
                    <div style={{ height: "120px", background: "var(--parchment-dark)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      {org.image_path ? (
                        <img src={org.image_path} alt={org.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span style={{ fontSize: "3rem" }}>🏰</span>
                      )}
                    </div>
                    <div style={{ padding: "0.6rem 0.75rem" }}>
                      <strong style={{ display: "block", marginBottom: "0.2rem", fontFamily: "'Cinzel', serif", color: "var(--sienna-dark)" }}>{org.name}</strong>
                      {org.description && <p style={{ margin: "0 0 0.4rem", fontSize: "0.82rem", color: "var(--ink-light)", lineHeight: 1.3 }}>{org.description}</p>}
                      <small style={{ color: "var(--gold-dark)" }}>{memberCount} {memberCount !== 1 ? t('organizations.members') : t('organizations.member')}</small>
                      {hasPagePermission("organizations", "edit") && (
                        <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
                          <label style={{ fontSize: "0.78rem", cursor: "pointer" }} title={t('common.replaceImage')}>
                            {t('common.imageLabel')}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadOrganizationImage(org.id, e.target.files[0]); }} />
                          </label>
                          <button type="button" onClick={() => deleteOrganization(org.id)} style={{ fontSize: "0.78rem", padding: "2px 6px" }}>{t('common.delete')}</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedOrg && (
              <div style={{ marginTop: "1.5rem", border: "2px solid var(--sienna)", borderRadius: "var(--border-radius)", overflow: "hidden", background: "linear-gradient(160deg, #f9f0db 0%, #ecddb8 100%)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1rem", background: "rgba(107,45,15,0.08)", borderBottom: "1px solid var(--gold-dark)" }}>
                  {selectedOrg.image_path && (
                    <img
                      src={selectedOrg.image_path}
                      alt={selectedOrg.name}
                      onClick={(e) => { e.stopPropagation(); setSelectedOrgImage(selectedOrg.image_path); }}
                      style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "6px", cursor: "zoom-in", border: "2px solid var(--gold-dark)", flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flexGrow: 1 }}>
                    <h3 style={{ margin: 0, fontFamily: "'Cinzel', serif", color: "var(--sienna-dark)" }}>{selectedOrg.name}</h3>
                    {selectedOrg.description && <p style={{ margin: "0.2rem 0 0", color: "var(--ink-mid)", fontSize: "0.9rem" }}>{selectedOrg.description}</p>}
                  </div>
                  <button type="button" onClick={() => setSelectedOrg(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--sienna)" }}>✕</button>
                </div>
                <div style={{ padding: "1rem" }}>
                  <CampaignEntryTools key={selectedOrg.id} collection="organizations" entry={selectedOrg}
                    editable={hasPagePermission("organizations", "edit")} api={request}
                    refresh={refreshOrganizations} onView={setSelectedOrgImage} />
                  <h4 style={{ margin: "0 0 0.75rem" }}>{t('organizations.membersSection')}</h4>
                  {allies.filter((a) => a.organization_id === selectedOrg.id).length === 0 ? (
                    <p style={{ margin: 0 }}>{t('organizations.noMembers')}</p>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                      {allies.filter((a) => a.organization_id === selectedOrg.id).map((ally) => (
                        <div key={ally.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.75rem", border: "1px solid var(--gold-dark)", borderRadius: "var(--border-radius)", background: "rgba(255,255,255,0.45)" }}>
                          {ally.image_path ? (
                            <img src={ally.image_path} alt={ally.name} style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "50%", border: "2px solid var(--gold-dark)" }} />
                          ) : (
                            <span style={{ fontSize: "1.4rem" }}>👤</span>
                          )}
                          <div>
                            <strong style={{ fontSize: "0.9rem" }}>{ally.name}</strong>
                            {ally.role && <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--ink-light)" }}>{ally.role}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {selectedOrgImage && (
            <div onClick={() => setSelectedOrgImage(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
              <img src={selectedOrgImage} alt={t("common.imageLabel")} style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
            </div>
          )}
        </section>
      ) : null}

      {/* NPCS VIEW */}
      {activeView === "npcs" ? (
        <section className="grid">
          <article className="card wide">
            <h2>{t('npcs.title')}</h2>
            {hasPagePermission("npcs", "edit") && (
              <details className="character-sheet-panel">
                <summary>{t("admin.addNPC")}</summary>
                <form onSubmit={submitAlly} className="form">
                  <input
                    value={allyDraft.name}
                    onChange={(e) => setAllyDraft((old) => ({ ...old, name: e.target.value }))}
                    placeholder={t('common.name')}
                    required
                  />
                  <input
                    value={allyDraft.role}
                    onChange={(e) => setAllyDraft((old) => ({ ...old, role: e.target.value }))}
                    placeholder={t('admin.rolePlaceholder')}
                  />
                  <input
                    value={allyDraft.location}
                    onChange={(e) => setAllyDraft((old) => ({ ...old, location: e.target.value }))}
                    placeholder={t('admin.locationPlaceholder')}
                  />
                  <textarea
                    value={allyDraft.relationship}
                    onChange={(e) => setAllyDraft((old) => ({ ...old, relationship: e.target.value }))}
                    placeholder={t('admin.relationshipPlaceholder')}
                    rows={2}
                  />
                  <textarea
                    value={allyDraft.notes}
                    onChange={(e) => setAllyDraft((old) => ({ ...old, notes: e.target.value }))}
                    placeholder={t('common.notes')}
                    rows={3}
                  />
                  <select
                    value={allyDraft.organization_id ?? ""}
                    onChange={(e) => setAllyDraft((old) => ({ ...old, organization_id: e.target.value ? Number(e.target.value) : null }))}
                  >
                    <option value="">{t('admin.noOrgOption')}</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                  <label style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                    🖼️ {allyImageFile ? allyImageFile.name : t('admin.portraitOptional')}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setAllyImageFile(e.target.files[0] || null)} />
                  </label>
                  <button type="submit">{t('admin.addNPCBtn')}</button>
                </form>
                {allyError ? <p className="error">{allyError}</p> : null}
              </details>
            )}

            <h3>{t('npcs.known')}</h3>
            <ul>
              {allies.map((ally) => {
                const org = organizations.find((o) => o.id === ally.organization_id);
                return (
                  <li key={ally.id} style={{ marginBottom: "1rem", padding: "0.5rem", border: "1px solid #ddd", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                    {ally.image_path ? (
                      <img
                        src={ally.image_path}
                        alt={ally.name}
                        onClick={() => setSelectedAllyImage(ally.image_path)}
                        style={{ width: "56px", height: "56px", objectFit: "cover", borderRadius: "50%", cursor: "pointer", border: "2px solid #8b4513", flexShrink: 0 }}
                        title={t('common.clickToView')}
                      />
                     ) : hasPagePermission("npcs", "edit") ? (
                      <label style={{ width: "56px", height: "56px", borderRadius: "50%", border: "2px dashed #8b4513", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontSize: "1.4rem" }} title={t('npcs.addPortrait')}>
                        👤
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadAllyImage(ally.id, e.target.files[0]); }} />
                      </label>
                    ) : (
                      <span style={{ width: "56px", height: "56px", borderRadius: "50%", border: "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", flexShrink: 0 }}>👤</span>
                    )}
                    <div className="campaign-entry-content">
                      <div className="row">
                        <div>
                          <strong>{ally.name}</strong>
                          {org && (
                            <span
                              onClick={() => { navigate("organizations"); setSelectedOrg(org); }}
                              style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "#8b4513", cursor: "pointer", textDecoration: "underline" }}
                              title={t('npcs.goToOrg')}
                            >({org.name})</span>
                          )}
                          {ally.alignment === "allied" && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", background: "#2d6a2d", color: "#fff", borderRadius: "4px", padding: "1px 6px" }}>{t('npcs.allied')}</span>}
                          {ally.alignment === "foe" && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", background: "#8b1a1a", color: "#fff", borderRadius: "4px", padding: "1px 6px" }}>{t('npcs.foe')}</span>}
                          {ally.alignment === "neutral" && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", background: "#666", color: "#fff", borderRadius: "4px", padding: "1px 6px" }}>{t('npcs.neutral')}</span>}
                        </div>
                        <div style={{ display: "flex", gap: "0.25rem" }}>
                          {hasPagePermission("npcs", "edit") && ally.image_path && (
                            <label style={{ fontSize: "0.8rem", cursor: "pointer" }} title={t('common.replaceImage')}>
                              🔄
                              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) uploadAllyImage(ally.id, e.target.files[0]); }} />
                            </label>
                          )}
                          {hasPagePermission("npcs", "edit") && <button type="button" onClick={() => deleteAlly(ally.id)}>{t('common.delete')}</button>}
                        </div>
                      </div>
                      {hasPagePermission("npcs", "edit") && (
                        <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.4rem" }}>
                          <button
                            type="button"
                            onClick={() => setAllyAlignment(ally.id, "allied")}
                            style={{ fontSize: "0.75rem", padding: "2px 8px", background: ally.alignment === "allied" ? "#2d6a2d" : undefined, color: ally.alignment === "allied" ? "#fff" : undefined }}
                          >{t('npcs.allied')}</button>
                          <button
                            type="button"
                            onClick={() => setAllyAlignment(ally.id, "neutral")}
                            style={{ fontSize: "0.75rem", padding: "2px 8px", background: ally.alignment === "neutral" ? "#555" : undefined, color: ally.alignment === "neutral" ? "#fff" : undefined }}
                          >{t('npcs.neutral')}</button>
                          <button
                            type="button"
                            onClick={() => setAllyAlignment(ally.id, "foe")}
                            style={{ fontSize: "0.75rem", padding: "2px 8px", background: ally.alignment === "foe" ? "#8b1a1a" : undefined, color: ally.alignment === "foe" ? "#fff" : undefined }}
                          >{t('npcs.foe')}</button>
                        </div>
                      )}
                      {ally.role && <p style={{ margin: "0.2rem 0 0" }}><strong>{t('npcs.roleLabel')}</strong> {ally.role}</p>}
                      {ally.location && <p style={{ margin: "0.2rem 0 0" }}><strong>{t('npcs.locationLabel')}</strong> {ally.location}</p>}
                      {ally.relationship && <p style={{ margin: "0.2rem 0 0" }}><strong>{t('npcs.relationshipLabel')}</strong> {ally.relationship}</p>}
                      {ally.notes && <p style={{ margin: "0.2rem 0 0" }}><strong>{t('npcs.notesLabel')}</strong> {ally.notes}</p>}
                      <CampaignEntryTools collection="allies" entry={ally} organizations={organizations}
                        editable={hasPagePermission("npcs", "edit")} api={request}
                        refresh={refreshAllies} onView={setSelectedAllyImage} />
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
          <img src={selectedAllyImage} alt={t("common.imageLabel")} style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "6px", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }} />
        </div>
      )}

      {/* ADMIN VIEW (/admin) */}
      {activeView === "admin" && isAuthenticated && hasPagePermission("admin", "admin") ? (
        <section className="grid">
          <article className="card wide">
            <h2>{t('admin.userManagement')}</h2>
            <form onSubmit={createUser} className="form">
              <input
                value={newUserData.username}
                onChange={(event) => setNewUserData((old) => ({ ...old, username: event.target.value }))}
                placeholder={t('auth.usernamePlaceholder')}
                required
              />
              <input
                type="email"
                value={newUserData.email}
                onChange={(event) => setNewUserData((old) => ({ ...old, email: event.target.value }))}
                placeholder={t("auth.email")}
                required
              />
              <input
                type="password"
                value={newUserData.password}
                onChange={(event) => setNewUserData((old) => ({ ...old, password: event.target.value }))}
                placeholder={t('auth.passwordPlaceholder')}
                required
              />
              <button type="submit">{t('admin.createUser')}</button>
            </form>
            <button type="button" onClick={loadUsers} style={{ marginBottom: "1rem" }}>
              {t('admin.refreshUsers')}
            </button>
            {users.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t('auth.username')}</th>
                      {PAGE_KEYS.map((pageKey) => (
                        <th key={pageKey}>{t(`admin.pageNames.${pageKey}`)}</th>
                      ))}
                      <th>{t('admin.resetPassword')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => {
                      const permissionMap = Object.fromEntries((user.permissions ?? []).map((item) => [item.page_key, item.permission_level]));

                      return (
                        <tr key={user.id}>
                          <td>
                            <strong>{user.username}</strong>
                            {user.id === currentUser?.id ? <span style={{ marginLeft: "0.5rem", color: "#8b4513" }}>{t('admin.currentUser')}</span> : null}
                          </td>
                          {PAGE_KEYS.map((pageKey) => {
                            const permissionLocked = user.is_admin || (user.id === currentUser?.id && pageKey === "admin");
                            return (
                              <td key={pageKey}>
                                <select
                                  value={permissionMap[pageKey] ?? "none"}
                                  disabled={permissionLocked}
                                  onChange={(event) => updatePermission(user.id, pageKey, event.target.value)}
                                >
                                  {PERMISSION_OPTIONS.map((option) => (
                                    <option key={option} value={option}>{t(`admin.permissionLevels.${option}`)}</option>
                                  ))}
                                </select>
                              </td>
                            );
                          })}
                          <td>
                            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                              <input
                                type="password"
                                value={passwordResetDrafts[user.id] ?? ""}
                                onChange={(event) => setPasswordResetDrafts((drafts) => ({ ...drafts, [user.id]: event.target.value }))}
                                placeholder={t('admin.newPassword')}
                              />
                              <button type="button" disabled={user.is_admin && !currentUser?.is_admin} onClick={() => resetUserPassword(user.id)}>{t('admin.resetPassword')}</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {users.length === 0 && <p><small>{t('admin.loadUsersHint')}</small></p>}
            {userManagementError ? <p className="error">{userManagementError}</p> : null}
          </article>
        </section>
      ) : activeView === "admin" && !isAuthenticated ? (
        <section className="grid">
          <article className="card">
            <h2>{t('admin.loginRequired')}</h2>
            <p>{t('admin.loginRequiredMsg')}</p>
            <button type="button" onClick={() => navigate("login")} style={{ marginTop: "1rem" }}>
              {t('admin.goToLogin')}
            </button>
          </article>
        </section>
      ) : activeView === "admin" && isAuthenticated && !hasPagePermission("admin", "admin") ? (
        <section className="grid">
          <article className="card">
            <h2>{t('admin.accessDenied')}</h2>
            <p>{t('admin.accessDeniedMsg')}</p>
          </article>
        </section>
      ) : null}
    </main>
  );
}

export default App;
