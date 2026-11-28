import { useEffect, useRef, useState } from "react";
import { ListFilter, Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { markerCategories, markerCategory } from "./atlasMarkers";

const markerKey = (row) => `${row.event_type ? "event" : "poi"}-${row.id}`;

export function AtlasMap({ events, onMapClick, mapImageUrl, mapId, tempMarker, linkedPlace, hiddenTypes, setHiddenTypes }) {
  const { t } = useTranslation();
  const root = useRef(null);
  const canvas = useRef(null);
  const drag = useRef(null);
  const didDrag = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [image, setImage] = useState({ width: 4, height: 3 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [selection, setSelection] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const visibleEvents = events.filter((row) => !hiddenTypes.includes(markerCategory(row)));
  const active = visibleEvents.find((row) => markerKey(row) === selection);

  function toggleCategory(type, visible) {
    if (!visible && active && markerCategory(active) === type) setSelection(null);
    setHiddenTypes((types) => visible ? types.filter((key) => key !== type) : [...types, type]);
  }
  const fit = Math.min(size.width / image.width, size.height / image.height);
  const width = image.width * fit * view.zoom;
  const height = image.height * fit * view.zoom;
  const left = (size.width - width) / 2 + view.x;
  const top = (size.height - height) / 2 + view.y;

  useEffect(() => {
    const node = canvas.current;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setView({ zoom: 1, x: 0, y: 0 });
    setSelection(null);
  }, [mapId]);

  useEffect(() => {
    if (linkedPlace?.map_id === mapId) setSelection(markerKey(linkedPlace));
  }, [linkedPlace, mapId]);

  const zoom = (factor) => setView((current) => ({ ...current, zoom: Math.min(8, Math.max(.5, current.zoom * factor)) }));
  useEffect(() => {
    const node = canvas.current;
    const wheel = (event) => {
      if (!event.ctrlKey && document.activeElement !== node) return;
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);

  useEffect(() => {
    const report = () => setExpanded(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", report);
    return () => document.removeEventListener("fullscreenchange", report);
  }, []);

  async function toggleFullScreen() {
    if (document.fullscreenElement === root.current) {
      await document.exitFullscreen();
      return;
    }
    if (expanded) { setExpanded(false); return; }
    if (root.current.requestFullscreen) {
      try { await root.current.requestFullscreen(); return; } catch { /* Use the in-page view when fullscreen is unavailable. */ }
    }
    setExpanded(true);
  }

  return <div ref={root} className="atlas-map" style={{ "--atlas-ratio": image.width / image.height }} data-expanded={expanded} onKeyDown={(event) => {
    if (event.key === "Escape") {
      setSelection(null);
      if (!document.fullscreenElement) setExpanded(false);
    }
  }}>
    <div className="atlas-controls" role="group" aria-label={t("shell.mapControls")}>
      <button type="button" aria-label={t("shell.zoomIn")} title={t("shell.zoomIn")} onClick={() => zoom(1.25)}><Plus size={18} /></button>
      <button type="button" aria-label={t("shell.zoomOut")} title={t("shell.zoomOut")} onClick={() => zoom(.8)}><Minus size={18} /></button>
      <button type="button" aria-label={t("tracker.resetView")} title={t("tracker.resetView")}
        onClick={() => setView({ zoom: 1, x: 0, y: 0 })}><RotateCcw size={17} /></button>
      <button type="button" aria-label={t(expanded ? "shell.exitFullscreen" : "shell.fullscreen")}
        title={t(expanded ? "shell.exitFullscreen" : "shell.fullscreen")} onClick={toggleFullScreen}>
        {expanded ? <X size={18} /> : <Maximize2 size={18} />}
      </button>
    </div>
    <div ref={canvas} className="atlas-canvas" tabIndex={0} aria-label={t("tracker.worldMap")}
      onKeyDown={(event) => {
        if (event.target !== canvas.current) return;
        const delta = { ArrowLeft: [32,0], ArrowRight: [-32,0], ArrowUp: [0,32], ArrowDown: [0,-32] }[event.key];
        if (delta) {
          event.preventDefault();
          setView((v) => ({ ...v, x: v.x + delta[0], y: v.y + delta[1] }));
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        drag.current = { x: event.clientX, y: event.clientY, view };
        didDrag.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        if (Math.hypot(dx, dy) > 4) didDrag.current = true;
        if (didDrag.current) setView({ ...drag.current.view, x: drag.current.view.x + dx, y: drag.current.view.y + dy });
      }}
      onPointerCancel={() => { drag.current = null; didDrag.current = true; }}
      onPointerUp={() => { drag.current = null; }}
      onClick={(event) => {
        if (didDrag.current || !onMapClick || !width || !height || event.target.closest("button")) return;
        const bounds = canvas.current.getBoundingClientRect();
        const latitude = (event.clientY - bounds.top - top) / height * 100;
        const longitude = (event.clientX - bounds.left - left) / width * 100;
        if (latitude >= 0 && latitude <= 100 && longitude >= 0 && longitude <= 100) {
          onMapClick({ latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)) });
        }
      }}>
      <div className="atlas-image-plane" style={{ width, height, left, top }}>
        <img src={mapImageUrl} alt={t("tracker.worldMap")} draggable={false} onLoad={(event) => {
          setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
        }} />
        {tempMarker && <span className="marker marker-temp" style={{ top: `${tempMarker.latitude}%`, left: `${tempMarker.longitude}%` }} />}
        {visibleEvents.map((row) => <button key={markerKey(row)} type="button"
          className="marker"
          data-marker-category={markerCategory(row)}
          style={{ top: `${row.latitude}%`, left: `${row.longitude}%`, "--marker-paint": markerCategories[markerCategory(row)] }}
          aria-expanded={selection === markerKey(row)} aria-label={row.title} title={row.title}
          onClick={() => setSelection(selection === markerKey(row) ? null : markerKey(row))} />)}
      </div>
    </div>
    <div className="atlas-overlays">
      <details className="atlas-legend">
        <summary><ListFilter size={16} aria-hidden="true" /> {t("shell.mapLegend")}</summary>
        <fieldset>
          <legend className="atlas-sr-only">{t("shell.mapCategoryFilters")}</legend>
          {Object.entries(markerCategories).map(([type, paint]) => <label key={type}>
            <input type="checkbox" checked={!hiddenTypes.includes(type)}
              onChange={(event) => toggleCategory(type, event.target.checked)} />
            <span className="atlas-legend-swatch" aria-hidden="true"
              data-swatch-category={type} style={{ "--marker-paint": paint }} />
            <span>{t(`shell.markerCategories.${type}`)}</span>
          </label>)}
        </fieldset>
      </details>
      {active && <section className="atlas-marker-detail" aria-label={active.title}>
        <div className="row"><strong>{active.title}</strong>
          <button type="button" aria-label={t("tracker.closeMarker")} onClick={() => setSelection(null)}><X size={17} /></button>
        </div>
        <small>{t(`tracker.${markerCategory(active)}`)}</small>
        {active.description && <p>{active.description}</p>}
        {active.image_path && <img src={active.image_path} alt={active.title} />}
      </section>}
    </div>
  </div>;
}
