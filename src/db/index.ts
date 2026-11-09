import { drizzle } from "drizzle-orm/node-postgres";
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

const pool = new Pool({ connectionString: databaseUrl() });

export const db = drizzle(pool, { schema });
export { schema };
