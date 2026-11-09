import { config } from "dotenv";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../src/db/schema";

/**
 * Shared plumbing for the local scripts (seed, full-flow, timing check,
 * dev setup). Scripts run headless via tsx against the same source modules
 * the app uses — no logic of its own lives here.
 */

export type ScriptDb = NodePgDatabase<typeof schema>;

/** Load .env.local (wins) then .env, and fail with a friendly message. */
export function loadEnv(): string {
  config({ path: ".env.local" });
  config({ path: ".env" });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Copy .env.example to .env (or run `pnpm dev`, which does it for you), then start Postgres with `docker compose up -d`."
    );
    process.exit(1);
  }
  return url;
}

export function connect(url: string): { db: ScriptDb; pool: Pool } {
  const pool = new Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), pool };
}

/** Print a numbered step banner — the script output doubles as demo notes. */
export function step(n: number, title: string): void {
  console.log(`\n[${n}] ${title}`);
}

export function fail(message: string): never {
  console.error(`\nFAIL: ${message}`);
  process.exit(1);
}

export function assert(condition: boolean, message: string): void {
  if (!condition) fail(message);
  console.log(`  ok: ${message}`);
}
