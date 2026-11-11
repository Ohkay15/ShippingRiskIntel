# ShippingRiskIntel

A shipment risk layer: score every shipment, explain it, and surface the
coverage gap. See the MVP spec and roadmap for scope and phasing.

## Stack

- Next.js (App Router, TypeScript) · Drizzle ORM · Zod · Vitest
- Postgres: Docker locally, Neon on Vercel — only `DATABASE_URL` changes

## Setup — one command

```bash
pnpm install && docker compose up -d && pnpm dev
```

That is the whole setup on a clean machine. `pnpm dev` runs a setup step
before the dev server, which:

1. creates `.env` from `.env.example` if it is missing (local defaults work as-is),
2. checks Postgres is reachable (if not: run `docker compose up -d` and retry),
3. applies the schema (`drizzle-kit push` — a no-op when already in sync),
4. seeds the 40-record synthetic demo dataset **if the shipments table is
   empty** — a restart never clobbers records you have edited.

Open http://localhost:3000 — the dashboard is populated and demo-ready.

To reset the demo data to its pristine state at any time: `pnpm seed`
(idempotent — it upserts the 40 fixed records, replacing any changes).

## Verify the whole pipeline in one pass

```bash
pnpm fullflow
```

Drives the real pipeline end to end against the database, printing each
step and asserting the lifecycle at every stage:

```
intake (draft) → upload invoice → confirm & extract (0.75 confidence gate)
→ review resolve (accept flagged at default) → Scored
→ carrier recommendations (projected deltas) → pick → Actioned
```

It calls the same service functions the UI's server actions use, so a
passing run certifies the pipeline. The run uses one fixed record (SH-990),
is safe to re-run, and leaves the Actioned record in place — open
http://localhost:3000/shipments/00000000-0000-4000-8000-000000000990 to see
it in the UI. To watch each step in the browser instead, run `pnpm dev`
beside it: intake form (`/shipments/new`), document upload and
"Confirm & extract" on the record page, review queue (`/review`), and the
carrier pick on the profile page.

## Timing: the 30-second record-to-profile metric

Measured with `pnpm timing` — it drives all 40 synthetic records through
the full pipeline (draft → upload → confirm & extract → review resolve →
Scored) and measures wall-clock time from intake to a stored profile:

| Records | Min | p50 | p95 | Max | Mean |
| ------- | --- | --- | --- | --- | ---- |
| 40 | 4.8 ms | 5.8 ms | 7.5 ms | 22.4 ms | 6.3 ms |

**30-second target: PASS** — the slowest record scored in 0.02 s. This is
machine time with the deterministic mock provider (instant, no network) on
a Linux sandbox; on a laptop expect the same order of magnitude. It does
not include the operator's own reading/decision time at the review step,
or a live LLM provider's network latency — with a live provider the
confirm-and-extract step takes on that provider's round-trip time, which
is the number to re-measure when one is registered. Re-run it yourself:
`pnpm timing` (measurement records use fixed ids and clean up after
themselves; the demo dataset is untouched).

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Setup (env, schema, demo seed if empty) + run the app locally |
| `pnpm seed` | Load the 40-record demo dataset (idempotent upsert; `pnpm seed -- --if-empty` skips when data exists) |
| `pnpm fullflow` | End-to-end pipeline test: intake → upload → extract → review → scored → actioned |
| `pnpm timing` | Measure intake-to-scored latency across the 40-record dataset |
| `pnpm db:push` | Apply the schema to `DATABASE_URL` |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint (flat config, next/core-web-vitals) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest suite |

## LLM provider

Extraction runs on the **deterministic mock provider** by default — same
input, same output, no network, no API key. A live provider activates with
**no code change**: register its factory in `src/llm/index.ts` (the one
place that knows providers), then set `LLM_PROVIDER` and the provider's
API key as environment variables (`.env` locally, Vercel env vars in
deployment). Call sites only ever see the typed `LlmClient` interface.

## Deployment (Vercel)

Push to the connected repo and set two env vars in the Vercel project:
`DATABASE_URL` (Neon connection string) and, if used, the LLM provider
variables. Nothing else differs from local.

Vercel runs the `vercel-build` script instead of `build`. It applies the
schema (`drizzle-kit push`), seeds the 40-record demo dataset **only if the
shipments table is empty**, then runs `next build` — so a fresh database is
ready after one deploy, and later deploys never overwrite edited records.
