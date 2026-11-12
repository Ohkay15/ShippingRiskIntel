"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconMap, IconPlug, IconPlus, IconReview, IconRoute, IconShipments, IconSpark } from "./icons";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

const NAV = [
  { href: "/", label: "Shipments", icon: IconShipments, match: (p: string) => p === "/" || (p.startsWith("/shipments/") && p !== "/shipments/new") },
  { href: "/review", label: "Review queue", icon: IconReview, match: (p: string) => p.startsWith("/review") },
  { href: "/map", label: "Live map", icon: IconMap, match: (p: string) => p.startsWith("/map") },
  { href: "/assistant", label: "Assistant", icon: IconSpark, match: (p: string) => p.startsWith("/assistant") },
  { href: "/integrations", label: "Integrations", icon: IconPlug, match: (p: string) => p.startsWith("/integrations") },
] as const;

export function AppSidebar({
  connectedCount,
  user,
}: {
  connectedCount: number;
  user: { name: string; email: string } | null;
}) {
  const pathname = usePathname() ?? "/";
  return (
    <aside className="sidebar" aria-label="Main">
      <Link href="/" className="sidebar-brand">
        <span className="brand-mark">
          <IconRoute size={15} className="icon" />
        </span>
        <span>ShippingRiskIntel</span>
      </Link>

      <Link href="/shipments/new" className="sidebar-new" aria-current={pathname === "/shipments/new" ? "page" : undefined}>
        <IconPlus />
        <span>New shipment</span>
      </Link>

      <nav className="sidebar-nav">
        <p className="sidebar-section-label">Workspace</p>
        {NAV.map(({ href, label, icon: Icon, match }) => (
          <Link key={href} href={href} className="sidebar-link" aria-current={match(pathname) ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
            {href === "/integrations" && <span className="sidebar-count">{connectedCount} live</span>}
          </Link>
        ))}
      </nav>

      {user && (
      <Link
        href="/settings"
        className="sidebar-user"
        aria-current={pathname.startsWith("/settings") ? "page" : undefined}
        title="Account settings"
      >
        <span className="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="sidebar-user-text">
          <span className="sidebar-user-name">{user.name}</span>
          <span className="sidebar-user-email">{user.email}</span>
        </span>
      </Link>
      )}
    </aside>
  );
}
