"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconPlug, IconPlus, IconReview, IconRoute, IconShipments, IconSpark } from "./icons";

const NAV = [
  { href: "/", label: "Shipments", icon: IconShipments, match: (p: string) => p === "/" || (p.startsWith("/shipments/") && p !== "/shipments/new") },
  { href: "/review", label: "Review queue", icon: IconReview, match: (p: string) => p.startsWith("/review") },
  { href: "/assistant", label: "Assistant", icon: IconSpark, match: (p: string) => p.startsWith("/assistant") },
  { href: "/integrations", label: "Integrations", icon: IconPlug, match: (p: string) => p.startsWith("/integrations") },
] as const;

export function AppSidebar({ connectedCount }: { connectedCount: number }) {
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

      <div className="sidebar-foot">
        Score every shipment, explain it, and close the coverage gap.
      </div>
    </aside>
  );
}
