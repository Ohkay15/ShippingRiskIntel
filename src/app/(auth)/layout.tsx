import Link from "next/link";

import { IconRoute } from "@/ui/icons";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <Link href="/" className="sidebar-brand auth-brand">
        <span className="brand-mark">
          <IconRoute size={15} className="icon" />
        </span>
        <span>ShippingRiskIntel</span>
      </Link>
      <main className="auth-card">{children}</main>
      <p className="auth-foot">Score every shipment, explain it, and close the coverage gap.</p>
    </div>
  );
}
