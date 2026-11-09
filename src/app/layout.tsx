import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShippingRiskIntel",
  description:
    "Shipment risk layer: score every shipment, explain it, and surface the coverage gap.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <nav className="site-nav">
          <Link href="/" className="site-nav-brand">
            ShippingRiskIntel
          </Link>
          <div className="site-nav-links">
            <Link href="/">Shipments</Link>
            <Link href="/review">Review queue</Link>
            <Link href="/shipments/new" className="button-primary">
              + New shipment
            </Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
