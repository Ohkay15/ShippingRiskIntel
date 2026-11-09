import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
