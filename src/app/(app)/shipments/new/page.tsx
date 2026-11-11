import { requireUser } from "@/auth/session";
import Link from "next/link";

import { createShipment } from "@/app/actions/shipments";
import { IntakeForm } from "@/intake/intake-form";

export const metadata = {
  title: "New shipment — ShippingRiskIntel",
};

export default async function NewShipmentPage() {
  await requireUser();
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>New shipment</h1>
          <p className="page-subtitle">
            Enter the shipment factors by hand, or leave fields unknown and
            attach documents to fill them later. Unknowns stay unknown —
            nothing here is guessed.
          </p>
        </div>
        <Link href="/" className="button-secondary">
          ← All shipments
        </Link>
      </header>

      <IntakeForm action={createShipment} submitLabel="Create draft record" />
    </main>
  );
}
