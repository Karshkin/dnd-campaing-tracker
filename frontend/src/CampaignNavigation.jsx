import { useEffect, useId, useState } from "react";
import { BookOpen, Boxes, Castle, CircleUser, Map, Menu, PanelLeftClose, PanelLeftOpen, Shield, ShoppingBag, Skull, Users, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const sections = [
  ["campaign", [["chronicle", "chronicle", "tracker", BookOpen]]],
  ["world", [
    ["characters", "characters", "characters", Users], ["npcs", "npcs", "npcs", CircleUser],
    ["organizations", "organizations", "organizations", Castle], ["tracker", "locations", "tracker", Map],
    ["bestiary", "bestiary", "bestiary", Skull],
  ]],
  ["tools", [["inventory", "inventory", "tracker", Boxes], ["merchants", "merchants", "tracker", ShoppingBag]]],
  ["administration", [["admin", "admin", "admin", Shield, "admin"]]],
];

function NavigationItem({ label, Icon, current, onClick }) {
  return <li><button className="navigation-item" type="button" aria-current={current ? "page" : undefined}
    aria-label={label} title={label} onClick={onClick}>
    <Icon size={19} aria-hidden="true" /><span>{label}</span>
  </button></li>;
}

function NavigationGroup({ title, children }) {
  return <section className="navigation-group" aria-label={title}>
    <h2>{title}</h2><ul>{children}</ul>
  </section>;
}

export function CampaignNavigation({ activeView, navigate, permitted }) {
  const { t } = useTranslation();
  const navigationId = useId();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileOpen]);

  return <aside className="campaign-sidebar" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
    <button type="button" className="sidebar-mobile" aria-controls={navigationId} aria-expanded={mobileOpen}
      onClick={() => setMobileOpen(!mobileOpen)}>
      {mobileOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />} {t("sidebar.menu")}
    </button>
    <button type="button" className="sidebar-collapse" aria-controls={navigationId} aria-expanded={!collapsed}
      aria-label={t(collapsed ? "sidebar.expand" : "sidebar.collapse")} onClick={() => setCollapsed(!collapsed)}>
      {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
    </button>
    <nav id={navigationId} className="sidebar-navigation" aria-label={t("sidebar.menu")}>
      {sections.map(([section, entries]) => {
        const available = entries.filter(([, , permission, , level]) => permitted(permission, level));
        return available.length > 0 && <NavigationGroup key={section} title={t(`sidebar.${section}`)}>
          {available.map(([view, label, , Icon]) => <NavigationItem key={view} label={t(`nav.${label}`)} Icon={Icon}
            current={view === activeView} onClick={() => { navigate(view); setMobileOpen(false); }} />)}
        </NavigationGroup>;
      })}
    </nav>
  </aside>;
}
