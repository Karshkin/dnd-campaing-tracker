import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import "./character-sheet.css";

export const defaultCharacterEmoji = "🧙";
const emojis = ["🧙", "🧝", "🧛", "🧚", "🥷", "🐉", "🐺", "🦊", "🦉", "🐈‍⬛", "🐻", "🦇", "⚔️", "🛡️", "🏹", "🪓", "🪄", "🔮", "📜", "🔥", "🌙", "💀", "🍀", "⚡"];
const fields = ["background", "equipment", "abilities", "appearance", "personality", "goals", "notes"];
const privateOptions = [...fields, "nivel20_url"];
const fieldLabel = (field) => field === "notes" ? "common.notes"
  : field === "nivel20_url" ? "characterSheet.nivel20Label" : `characterSheet.${field}`;

function nivel20Link(raw) {
  const value = raw?.trim();
  if (!value || !/^https:\/\/(www\.)?nivel20\.com\/[A-Za-z0-9]\S*$/.test(value)) return "";
  try {
    const url = new URL(value);
    return url.pathname !== "/" ? url.href : "";
  } catch {
    return "";
  }
}

export function sheetDraft(character = {}) {
  return {
    ...Object.fromEntries(["emoji", ...privateOptions].map((field) => [field, character[field] ?? ""])),
    private_fields: character.private_fields ?? [],
  };
}

export function SheetFields({ draft, onChange }) {
  const { t } = useTranslation();
  const fieldId = useId();
  return (
    <div className="character-sheet-fields">
      <label className="character-emoji-field">
        <span>{t("characterSheet.emoji")}</span>
        <select value={draft.emoji} onChange={(event) => onChange("emoji", event.target.value)}>
          <option value="">{defaultCharacterEmoji} {t("characterSheet.defaultEmoji")}</option>
          {emojis.map((emoji) => <option key={emoji} value={emoji}>{emoji}</option>)}
        </select>
      </label>
      <label className="character-nivel20-field">
        <span>{t("characterSheet.nivel20Label")}</span>
        <input type="url" inputMode="url" maxLength={2048} value={draft.nivel20_url}
          pattern={String.raw`https://(www\.)?nivel20\.com/[A-Za-z0-9]\S*`}
          placeholder="https://nivel20.com/…"
          onChange={(event) => {
            event.target.setCustomValidity("");
            onChange("nivel20_url", event.target.value.trim());
          }}
          onInvalid={(event) => event.target.setCustomValidity(t("characterSheet.nivel20Invalid"))}
        />
        <small>{t("characterSheet.nivel20Help")}</small>
      </label>
      {fields.map((field) => (
        <label key={field}>
          <span id={`${fieldId}-${field}`}>{t(fieldLabel(field))}</span>
          <textarea aria-labelledby={`${fieldId}-${field}`} rows={3} maxLength={4000} value={draft[field]}
            onChange={(event) => onChange(field, event.target.value)} />
        </label>
      ))}
      <fieldset className="character-privacy-options">
        <legend>{t("characterSheet.privateFields")}</legend>
        <p>{t("characterSheet.privacyHelp")}</p>
        {privateOptions.map((field) => (
          <label key={field}>
            <input type="checkbox" checked={draft.private_fields.includes(field)}
              onChange={(event) => onChange("private_fields", event.target.checked
                ? [...draft.private_fields, field]
                : draft.private_fields.filter((item) => item !== field))} />
            {t(fieldLabel(field))}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function CharacterSheet({ character, editable, onSave }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const externalSheet = nivel20Link(character.nivel20_url);
  const populated = fields.filter((field) => character[field]?.trim());

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      if (await onSave(draft)) setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="character-sheet-panel">
      <div className="character-section-heading">
        <h4>{t("characterSheet.title")}</h4>
        <div className="character-sheet-actions">
          {!draft && externalSheet && (
            <a className="character-nivel20-link" href={externalSheet} target="_blank" rel="noopener noreferrer">
              {t("characterSheet.openNivel20")} <span aria-hidden="true">↗</span>
            </a>
          )}
          {editable && !draft && (
            <button type="button" onClick={() => setDraft(sheetDraft(character))}>
              {t("characterSheet.edit")}
            </button>
          )}
        </div>
      </div>
      {editable && draft ? (
        <form className="form" onSubmit={save}>
          <SheetFields draft={draft} onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))} />
          <div className="character-sheet-actions">
            <button type="submit" disabled={saving}>{t("common.save")}</button>
            <button type="button" disabled={saving} onClick={() => setDraft(null)}>{t("common.cancel")}</button>
          </div>
        </form>
      ) : populated.length ? (
        <dl className="character-sheet-facts">
          {populated.map((field) => (
            <div key={field}>
              <dt>{t(fieldLabel(field))}
                {character.private_fields?.includes(field) && <small> · {t("characterSheet.privateTag")}</small>}
              </dt>
              <dd>{character[field]}</dd>
            </div>
          ))}
        </dl>
      ) : !externalSheet ? <p className="character-sheet-empty">{t("characterSheet.empty")}</p> : null}
    </section>
  );
}

export function ImageGallery({ editable, api, path, onView, imageLabel = "characterSheet.image" }) {
  const { t } = useTranslation();
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let latest = 0;
    const refresh = async () => {
      const request = ++latest;
      const result = await api(path);
      if (result.ok) {
        const rows = await result.json();
        if (active && request === latest) setImages(rows);
      }
    };
    refresh();
    const timer = setInterval(refresh, 12 * 60 * 1000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [path, revision]);

  async function add(event) {
    const files = Array.from(event.currentTarget.files);
    event.currentTarget.value = "";
    setBusy(true);
    try {
      for (const file of files) {
        const response = await api(path, { method: "POST", body: file });
        if (!response.ok) break;
      }
    } finally {
      setBusy(false);
      setRevision((value) => value + 1);
    }
  }

  async function remove(id) {
    if (!window.confirm(t("characterSheet.confirmRemoveImage"))) return;
    setBusy(true);
    try {
      await api(`${path}/${id}`, { method: "DELETE" });
    } finally {
      setBusy(false);
      setRevision((value) => value + 1);
    }
  }

  return (
    <section className="character-sheet-panel">
      <div className="character-section-heading">
        <h4>{t("characterSheet.gallery")}</h4>
        {editable && (
          <label className="character-gallery-upload">
            <span>{t("characterSheet.addImages")}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/tiff"
              multiple disabled={busy} onChange={add} />
          </label>
        )}
      </div>
      {images.length ? (
        <ul className="character-gallery-grid">
          {images.map(({ id, url }, index) => (
            <li key={id}>
              {url && (
                <button type="button" className="character-gallery-image" onClick={() => onView(url)}>
                  <img src={url} alt={t(imageLabel, { number: index + 1 })} loading="lazy" />
                </button>
              )}
              {editable && <button type="button" disabled={busy} onClick={() => remove(id)}>{t("common.delete")}</button>}
            </li>
          ))}
        </ul>
      ) : <p className="character-sheet-empty">{t("characterSheet.noImages")}</p>}
    </section>
  );
}
