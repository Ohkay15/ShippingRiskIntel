import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { integrationStatusReport, processEnv, statusCounts } from "@/integrations/status";
import { AppSidebar } from "@/ui/app-sidebar";
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
  const connected = statusCounts(integrationStatusReport(processEnv())).connected;
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <div className="app-shell">
          <AppSidebar connectedCount={connected} />
          <div className="app-main">{children}</div>
        </div>
      </body>
    </html>
  );
}
