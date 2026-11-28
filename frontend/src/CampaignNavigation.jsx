import { useEffect, useId, useState } from "react";
import { BookOpen, Boxes, Castle, CircleUser, LogOut, Map, Menu, PanelLeftClose, PanelLeftOpen, Shield, Skull, Users, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const sections = [
  ["campaign", [["chronicle", "chronicle", "tracker", BookOpen]]],
  ["world", [
    ["characters", "characters", "characters", Users],
    ["npcs", "npcs", "npcs", CircleUser],
    ["organizations", "organizations", "organizations", Castle],
    ["tracker", "locations", "tracker", Map],
    ["bestiary", "bestiary", "bestiary", Skull],
  ]],
  ["tools", [["inventory", "inventory", "tracker", Boxes]]],
  ["administration", [["admin", "admin", "admin", Shield, "admin"]]],
];

export function CampaignNavigation({ activeView, navigate, permitted, logout, tools }) {
  const { t } = useTranslation();
  const navigationId = useId();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const close = (event) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileOpen]);

  return <aside className="campaign-sidebar" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
    <button type="button" className="sidebar-mobile" aria-controls={navigationId} aria-expanded={mobileOpen}
      onClick={() => setMobileOpen(!mobileOpen)}>
      {mobileOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
      {t("sidebar.menu")}
    </button>
    <button type="button" className="sidebar-collapse" aria-controls={navigationId} aria-expanded={!collapsed}
      aria-label={t(collapsed ? "sidebar.expand" : "sidebar.collapse")} onClick={() => setCollapsed(!collapsed)}>
      {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
    </button>
    <nav id={navigationId} className="sidebar-navigation" aria-label={t("sidebar.menu")}>
      {sections.map(([section, entries]) => {
        const available = entries.filter(([, , permission, , level]) => permitted(permission, level));
        if (!available.length) return null;
        return <div key={section} className="sidebar-section">
          <p>{t(`sidebar.${section}`)}</p>
          <ul>{available.map(([view, label, , Icon]) => (
            <li key={view}><button type="button" aria-current={view === activeView ? "page" : undefined}
              aria-label={t(`nav.${label}`)} title={t(`nav.${label}`)} onClick={() => {
                navigate(view);
                setMobileOpen(false);
              }}>
              <Icon size={18} aria-hidden="true" /><span>{t(`nav.${label}`)}</span>
            </button></li>
          ))}</ul>
        </div>;
      })}
      <div className="sidebar-tools">{tools}</div>
      <button className="sidebar-logout" type="button" onClick={logout}
        title={t("nav.logout")} aria-label={t("nav.logout")}>
        <LogOut size={18} aria-hidden="true" /><span>{t("nav.logout")}</span>
      </button>
    </nav>
  </aside>;
}
