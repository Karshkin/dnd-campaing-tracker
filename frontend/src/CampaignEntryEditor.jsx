import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageGallery } from "./CharacterSheet";

const fields = {
  creatures: [
    ["name", "common.name", 120],
    ["creature_type", "bestiary.type", 50],
    ["challenge_rating", "admin.challengeRating", 20],
    ["armor_class", "admin.armorClass", "number"],
    ["hit_points", "admin.hitPoints", 50],
    ["speed", "admin.speedPlaceholder", 100],
    ["abilities", "admin.abilities", "textarea"],
    ["weaknesses", "admin.weaknesses", "textarea"],
    ["resistances", "admin.resistances", "textarea"],
    ["immunities", "admin.immunities", "textarea"],
    ["notes", "common.notes", "textarea"],
  ],
  allies: [
    ["name", "common.name", 120],
    ["role", "npcs.roleLabel", 100],
    ["location", "npcs.locationLabel", 120],
    ["alignment", "entryEditor.alignment", "alignment"],
    ["organization_id", "entryEditor.organization", "organization"],
    ["relationship", "npcs.relationshipLabel", "textarea"],
    ["notes", "common.notes", "textarea"],
  ],
  organizations: [
    ["name", "common.name", 120],
    ["description", "common.description", "textarea"],
  ],
};

export function CampaignEntryTools({ collection, entry, editable, organizations = [], api, refresh, onView }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(null);
  const [showGallery, setShowGallery] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const path = `/${collection}/${entry.id}`;
  const inputs = fields[collection];

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api(path, { method: "PUT", body: { ...draft, name: draft.name.trim() } });
      if (result.ok) {
        await refresh();
        setDraft(null);
      }
    } finally {
      setSaving(false);
    }
  }

  async function changeCover(file) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setCoverBusy(true);
    try {
      const result = await api(`${path}/image`, { method: "POST", body: form });
      if (result.ok) await refresh();
    } finally {
      setCoverBusy(false);
    }
  }

  async function removeCover() {
    if (!window.confirm(t("entryEditor.confirmRemoveCover"))) return;
    setCoverBusy(true);
    try {
      const result = await api(`${path}/image`, { method: "DELETE" });
      if (result.ok) await refresh();
    } finally {
      setCoverBusy(false);
    }
  }

  function editField(field, kind, value) {
    const next = kind === "organization" ? (value === "" ? null : Number(value))
      : kind === "number" ? Number(value) : value;
    setDraft((current) => ({ ...current, [field]: next }));
  }

  function fieldControl(field, kind) {
    const value = draft[field] ?? "";
    const onChange = (event) => editField(field, kind, event.target.value);
    switch (kind) {
      case "textarea": return <textarea rows={3} value={value} onChange={onChange} />;
      case "number": return <input type="number" min={0} value={value} onChange={onChange} />;
      case "organization":
        return (
          <select value={value} onChange={onChange}>
            <option value="">{t("characters.noOrg")}</option>
            {value && !organizations.some((org) => org.id === value) && (
              <option value={value}>{t("entryEditor.currentOrganization")}</option>
            )}
            {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
        );
      case "alignment":
        return (
          <select value={value} onChange={onChange}>
            {["allied", "neutral", "foe"].map((alignment) => (
              <option key={alignment} value={alignment}>{t(`npcs.${alignment}`)}</option>
            ))}
          </select>
        );
      default: return <input required={field === "name"} maxLength={kind} value={value} onChange={onChange} />;
    }
  }

  return (
    <div className="campaign-entry-tools">
      <div className="character-sheet-actions">
        {editable && !draft && (
          <button type="button" onClick={() => setDraft(Object.fromEntries(inputs.map(([key]) => [key, entry[key]])))}>
            {t("characterSheet.edit")}
          </button>
        )}
        <button type="button" aria-expanded={showGallery} onClick={() => setShowGallery(!showGallery)}>
          {t("characterSheet.gallery")}
        </button>
      </div>
      {editable && draft && (
        <div className="character-sheet-panel">
          <form className="form" onSubmit={save}>
            <div className="character-sheet-fields">
              {inputs.map(([field, label, kind]) => (
                <label key={field}>
                  <span>{t(label).replace(/:$/, "")}</span>
                  {fieldControl(field, kind)}
                </label>
              ))}
            </div>
            <div className="character-sheet-actions">
              <button type="submit" disabled={saving || !draft.name.trim()}>{t("common.save")}</button>
              <button type="button" disabled={saving} onClick={() => setDraft(null)}>{t("common.cancel")}</button>
            </div>
          </form>
          <div className="campaign-entry-cover">
            <label className="character-gallery-upload">
              <span>{t("entryEditor.cover")}</span>
              <input type="file" accept="image/*" disabled={coverBusy} onChange={(event) => {
                const file = event.currentTarget.files[0];
                event.currentTarget.value = "";
                changeCover(file);
              }} />
            </label>
            {entry.image_path && (
              <button type="button" disabled={coverBusy} onClick={removeCover}>{t("entryEditor.removeCover")}</button>
            )}
          </div>
        </div>
      )}
      {showGallery && (
        <ImageGallery editable={editable} api={api} path={`${path}/gallery`} onView={onView}
          imageLabel="entryEditor.image" />
      )}
    </div>
  );
}
