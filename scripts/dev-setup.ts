/**
 * One-command setup, run automatically before `pnpm dev`:
 *
 *   1. creates .env from .env.example if missing,
 *   2. checks Postgres is reachable (friendly hint if not),
 *   3. applies the schema (drizzle-kit push — a no-op when in sync),
 *   4. seeds the 40-record demo dataset if the shipments table is empty.
 *
 * Seeding is conditional so a restart never clobbers records the operator
 * edited; `pnpm seed` refreshes them on demand.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { sql } from "drizzle-orm";

import { connect, loadEnv } from "./lib";
import { seedDemoDatasetRows, shipmentCount } from "./seed-run";

async function main(): Promise<void> {
  if (!existsSync(".env")) {
    copyFileSync(".env.example", ".env");
    console.log("Created .env from .env.example (local defaults work as-is).");
  }

  const url = loadEnv();
  const { db, pool } = connect(url);

  try {
    // Connectivity probe with an actionable message — a failed drizzle-kit
    // push would say less.
    try {
      await db.execute(sql`select 1`);
    } catch {
      console.error(
        "\nPostgres is not reachable at the DATABASE_URL in .env. Start it with:\n  docker compose up -d\nthen run `pnpm dev` again."
      );
      process.exit(1);
    }
    console.log("Postgres is up.");

    const push = spawnSync("pnpm", ["exec", "drizzle-kit", "push", "--force"], {
      stdio: "inherit",
    });
    if (push.status !== 0) {
      console.error("\nSchema push failed — see drizzle-kit output above.");
      process.exit(push.status ?? 1);
    }

    const existing = await shipmentCount(db);
    if (existing === 0) {
      console.log("\nShipments table is empty — loading the 40-record demo dataset…");
      await seedDemoDatasetRows(db);
    } else {
      console.log(`\nDatabase already has ${existing} records — leaving them untouched (refresh with \`pnpm seed\`).`);
    }
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      `\nDev setup failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
