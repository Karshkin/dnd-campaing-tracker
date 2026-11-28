import { useEffect, useId, useRef, useState } from "react";
import { Bell, BookOpen, ChevronDown, CircleUser, LogOut, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function PageHeader({ title, description, actions }) {
  return <div className="page-heading">
    <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>;
}

export function AppShell({ theme, accent, header, sidebar, page, children }) {
  return <div className="campaign-theme app-shell" data-theme={theme} style={{ "--campaign-accent": accent }}>
    {header}
    {sidebar}
    <main className="app-main" data-page={page}>{children}</main>
  </div>;
}

function CampaignSearch({ entries }) {
  const { t } = useTranslation();
  const inputId = useId();
  const search = useRef(null);
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const results = normalized.length < 2 ? [] : entries
    .filter(({ title }) => title.toLocaleLowerCase().includes(normalized)).slice(0, 8);

  return <details className="header-popover" ref={search} onToggle={(event) => {
    if (event.currentTarget.open) event.currentTarget.querySelector("input")?.focus();
  }} onKeyDown={(event) => {
    if (event.key === "Escape") { search.current.open = false; search.current.querySelector("summary")?.focus(); }
  }}>
    <summary aria-label={t("shell.search")}><Search size={19} aria-hidden="true" /><span>{t("shell.search")}</span></summary>
    <div className="header-panel">
      <label htmlFor={inputId}>{t("shell.search")}</label>
      <input id={inputId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div aria-live="polite">
        {normalized.length >= 2 && (results.length ? <ul className="header-results">{results.map((result) =>
          <li key={result.key}><button type="button" onClick={() => {
            search.current.open = false;
            setQuery("");
            result.open();
          }}><strong>{result.title}</strong><small>{result.section}</small></button></li>
        )}</ul> : <p>{t("shell.noResults")}</p>)}
      </div>
    </div>
  </details>;
}

export function AppHeader({ campaign, emblem, selector, user, entries, notices, preferences, logout, authActions }) {
  const { t } = useTranslation();
  return <header className="app-header">
    <div className="app-identity">
      {emblem ? <img src={emblem} alt="" width="34" height="34" /> : <BookOpen size={23} aria-hidden="true" />}
      <span>{t("app.title")}</span>
    </div>
    {campaign && <div className="header-campaign">{selector}</div>}
    <div className="header-actions">
      {campaign ? <>
        <CampaignSearch entries={entries} />
        <details className="header-popover">
          <summary aria-label={t("shell.notices")}><Bell size={20} aria-hidden="true" /></summary>
          <div className="header-panel"><strong>{t("shell.notices")}</strong>
            {notices.length > 0 ? <ul className="header-results">{notices.map(({ key, title, section, open }) =>
              <li key={key}><button type="button" onClick={(event) => {
                event.currentTarget.closest("details").open = false;
                open();
              }}><strong>{title}</strong><small>{section}</small></button></li>
            )}</ul> : <p>{t("shell.noNotices")}</p>}
          </div>
        </details>
        <details className="header-popover">
          <summary aria-label={t("shell.account")}><CircleUser size={20} aria-hidden="true" />
            <span>{user}</span><ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="header-panel">{preferences}
            <button type="button" onClick={logout}><LogOut size={16} aria-hidden="true" /> {t("nav.logout")}</button>
          </div>
        </details>
      </> : <>{preferences}{authActions}</>}
    </div>
  </header>;
}

export function SideDialog({ title, close, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog className="side-dialog" aria-label={title} ref={ref} onCancel={close}>
    <div className="dialog-heading"><h2>{title}</h2>
      <button type="button" aria-label="Cerrar" onClick={close}><X size={20} aria-hidden="true" /></button>
    </div>
    {children}
  </dialog>;
}
