/**
 * Route-level loading state: every page is force-dynamic, so navigation
 * waits on a server render. This shell shows instantly while it renders,
 * keeping the dark surface instead of a blank white flash.
 */
export default function Loading() {
  return (
    <main className="page">
      <div className="state-panel" role="status" aria-live="polite">
        <h2>Loading…</h2>
        <p className="field-hint">Fetching shipment data.</p>
      </div>
    </main>
  );
}
