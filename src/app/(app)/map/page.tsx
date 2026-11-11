import { requireUser } from "@/auth/session";
import { NetworkMap } from "@/ui/network-map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live map" };

export default async function LiveMapPage() {
  await requireUser();
  return (
    <main className="page page-wide">
      <header className="page-header">
        <div>
          <h1>Live map</h1>
          <p className="field-hint">Every lane over live radar and severe-weather warnings, with the latest freight news.</p>
        </div>
      </header>
      <NetworkMap />
    </main>
  );
}
