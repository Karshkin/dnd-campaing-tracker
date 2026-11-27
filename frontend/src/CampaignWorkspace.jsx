import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { campaignLink, campaignSettings, replaceCampaignRef, selectedCampaignRef, supabase } from "./campaign";
import "./campaign-workspace.css";

function openCampaign(slug, keepView = false) {
  const location = new URL(window.location.href);
  location.searchParams.set("campaign", slug);
  if (!keepView) location.hash = "";
  window.location.replace(location);
}

function CreateCampaign() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      openCampaign(await campaignSettings.create(name.trim()));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <details className="campaign-create">
      <summary>{t("campaigns.create")}</summary>
      <form className="form" onSubmit={submit}>
        <label>{t("common.name")}
          <input value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || !name.trim()}>{t("campaigns.create")}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </details>
  );
}

export function CampaignSelector({ campaign, campaigns, isSuperadmin }) {
  const { t } = useTranslation();
  return (
    <div className="campaign-selector">
      <label className="campaign-picker">
        <span className="campaign-picker-caption">{t("campaigns.label")}</span>
        <span className="campaign-picker-control">
          <select value={campaign.slug} onChange={(event) => openCampaign(event.target.value)}>
            {campaigns.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
          </select>
        </span>
      </label>
      {isSuperadmin && <CreateCampaign />}
    </div>
  );
}

export function CampaignWorkspace({ userId, children }) {
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [images, setImages] = useState({});
  const campaign = campaigns?.find((item) => item.slug === selectedCampaignRef || item.id === selectedCampaignRef);
  const storageKey = `campaign-selection:${userId}`;

  useEffect(() => {
    let active = true;
    campaignSettings.list().then(({ campaigns: accessible, is_superadmin }) => {
      if (!active) return;
      const match = accessible.find((item) => item.slug === selectedCampaignRef || item.id === selectedCampaignRef);
      if (!match && accessible.length) {
        const remembered = accessible.find((item) => item.id === localStorage.getItem(storageKey));
        openCampaign((remembered ?? accessible[0]).slug, !selectedCampaignRef);
        return;
      }
      if (match) {
        if (selectedCampaignRef !== match.slug) replaceCampaignRef(match.slug);
        localStorage.setItem(storageKey, match.id);
      }
      setIsSuperadmin(is_superadmin);
      setCampaigns(accessible);
      setError("");
    }).catch((err) => {
      if (active) setError(err.message);
    });
    return () => { active = false; };
  }, [userId, storageKey, reload]);

  useEffect(() => {
    if (!campaign) return;
    let active = true;
    const refresh = () => campaignSettings.images(campaign).then((result) => {
      if (active) setImages(result);
    }).catch(() => {
      if (active) setImages({});
    });
    refresh();
    const timer = setInterval(refresh, 12 * 60 * 1000);
    return () => { active = false; clearInterval(timer); };
  }, [campaign]);

  if (!campaign) return (
    <main>
      <section className="card wide">
        <h1>{t("campaigns.title")}</h1>
        {error ? <p role="alert" className="error">{error}</p>
          : !campaigns ? <p role="status">{t("common.loading")}</p>
            : <p>{t("campaigns.empty")}</p>}
        {campaigns && isSuperadmin && <CreateCampaign />}
        <button type="button" onClick={() => setReload((current) => current + 1)}>{t("campaigns.refresh")}</button>
        <button type="button" onClick={() => supabase.auth.signOut({ scope: "local" })}>{t("nav.logout")}</button>
      </section>
    </main>
  );
  return children({
    campaign, campaigns, images, isSuperadmin,
    onSaved: (saved) => {
      if (saved.slug !== selectedCampaignRef) replaceCampaignRef(saved.slug);
      setCampaigns((current) => current.map((item) => item.id === saved.id ? saved : item));
    },
  });
}

export function CampaignAppearance({ campaign, images, onSaved }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    name: campaign.name, slug: campaign.slug, description: campaign.description, theme: campaign.theme, accent: campaign.accent,
  });
  const [artwork, setArtwork] = useState({});
  const [previews, setPreviews] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const urls = Object.fromEntries(Object.entries(artwork).flatMap(([kind, file]) =>
      file ? [[kind, URL.createObjectURL(file)]] : []));
    setPreviews(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [artwork]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await campaignSettings.save(campaign, { ...draft, name: draft.name.trim() }, artwork);
      onSaved(saved);
      setDraft((current) => ({ ...current, slug: saved.slug }));
      setArtwork({});
      setNotice(t("campaigns.saved"));
    } catch (err) {
      setError(err.code === "23505" ? t("campaigns.slugTaken") : err.message);
    } finally {
      setBusy(false);
    }
  }

  const cover = artwork.cover === null ? null : previews.cover || images[campaign.cover_path];
  const emblem = artwork.emblem === null ? null : previews.emblem || images[campaign.emblem_path];
  return (
    <article className="card wide">
      <h2>{t("campaigns.settings")}</h2>
      <div className="campaign-theme campaign-preview" data-theme={draft.theme} style={{ "--campaign-accent": draft.accent }}>
        {cover && <img className="campaign-cover" src={cover} alt="" />}
        <div className="campaign-brand">
          <img className="campaign-logo" src={emblem || `${import.meta.env.BASE_URL}d20.png`} alt="" />
          <h3>{draft.name}</h3>
        </div>
      </div>
      <form className="form campaign-settings-form" onSubmit={submit}>
        <label>{t("common.name")}
          <input value={draft.name} required maxLength={100} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <div>
          <label>{t("campaigns.slug")}
            <input value={draft.slug} required maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*"
              autoCapitalize="none" spellCheck={false} aria-describedby="campaign-link-help"
              onChange={(event) => setDraft({ ...draft, slug: event.target.value })} />
          </label>
          <small id="campaign-link-help">{t("campaigns.slugHelp")}</small>
        </div>
        <label>{t("campaigns.registrationLink")}
          <input type="url" readOnly value={campaignLink(campaign.slug, "register").href}
            onFocus={(event) => event.currentTarget.select()} />
        </label>
        <label>{t("common.description")}
          <textarea value={draft.description} maxLength={2000} rows={3}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <label>{t("campaigns.theme")}
          <select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value })}>
            {["parchment", "dark", "arcane"].map((theme) => <option value={theme} key={theme}>{t(`campaigns.${theme}`)}</option>)}
          </select>
        </label>
        <label>{t("campaigns.accent")}
          <input type="color" value={draft.accent} onChange={(event) => setDraft({ ...draft, accent: event.target.value })} />
        </label>
        {["cover", "emblem"].map((kind) => (
          <div key={kind}>
            <label>{t(`campaigns.${kind}`)}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/tiff"
                onChange={(event) => {
                  const file = event.target.files[0];
                  event.target.value = "";
                  if (file) setArtwork({ ...artwork, [kind]: file });
                }} />
            </label>
            {artwork[kind]?.name && <small>{artwork[kind].name}</small>}
            {(artwork[kind] || (artwork[kind] !== null && campaign[`${kind}_path`])) && (
              <button type="button" onClick={() => setArtwork({ ...artwork, [kind]: null })}>{t("campaigns.removeImage")}</button>
            )}
          </div>
        ))}
        <button type="submit" disabled={busy || !draft.name.trim()}>{t("common.save")}</button>
        {error && <p role="alert" className="error">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </form>
    </article>
  );
}
