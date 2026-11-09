"use client";

/**
 * Route-level error boundary: a failed server render keeps the dark
 * surface and points at the recovery step (local Postgres) instead of
 * dropping the user on the framework's default error page.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page">
      <div className="state-panel state-error" role="alert">
        <h1>Something went wrong</h1>
        <p>
          The page failed to render. Start Postgres with{" "}
          <code>docker compose up -d</code> and retry — most failures here are
          the database being unreachable.
        </p>
        <button type="button" className="button-secondary" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
