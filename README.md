# ShippingRiskIntel

A shipment risk layer: score every shipment, explain it, and surface the
coverage gap. See the MVP spec and roadmap for scope and phasing.

## Stack

- Next.js (App Router, TypeScript) · Drizzle ORM · Zod · Vitest
- Postgres: Docker locally, Neon on Vercel — only `DATABASE_URL` changes

## Setup

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL
docker compose up -d          # local Postgres
pnpm drizzle-kit push         # apply schema (drizzle-kit is a devDependency)
pnpm dev                      # http://localhost:3000
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app locally |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint (flat config, next/core-web-vitals) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest suite |
