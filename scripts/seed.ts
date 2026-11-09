/**
 * Seed the 40-record synthetic dataset into Postgres.
 *
 *   pnpm seed            upsert the dataset (idempotent — safe to re-run)
 *   pnpm seed -- --if-empty   only when the shipments table is empty
 *
 * The schema must exist first; `pnpm dev` applies it automatically
 * (or run `pnpm db:push`).
 */
import { connect, loadEnv, step } from "./lib";
import { seedDemoDatasetRows, shipmentCount } from "./seed-run";

async function main(): Promise<void> {
  const ifEmpty = process.argv.includes("--if-empty");
  const url = loadEnv();
  const { db, pool } = connect(url);

  try {
    const existing = await shipmentCount(db);
    if (ifEmpty && existing > 0) {
      console.log(`Shipments table already has ${existing} records — skipping seed.`);
      return;
    }

    step(1, "Seeding the 40-record synthetic dataset (upsert by fixed id)");
    const count = await seedDemoDatasetRows(db);
    console.log(`\nSeeded ${count} records. Start the app with \`pnpm dev\` and open http://localhost:3000.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    `\nSeed failed: ${error instanceof Error ? error.message : String(error)}`
  );
  console.error("Is Postgres running? Start it with `docker compose up -d`.");
  process.exit(1);
});
