import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and start Postgres with `docker compose up -d`."
    );
  }
  return url;
}

// Lazy singleton: the pool is created on first query, not at module load.
// Importing the db module must stay side-effect-free so `next build` (which
// evaluates route modules without a database) and unit tests never need a
// running Postgres.
let instance: NodePgDatabase<typeof schema> | undefined;

function getDb(): NodePgDatabase<typeof schema> {
  instance ??= drizzle(new Pool({ connectionString: databaseUrl() }), { schema });
  return instance;
}

export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    const client = getDb() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
export { schema };
