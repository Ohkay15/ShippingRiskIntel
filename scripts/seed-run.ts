import { sql } from "drizzle-orm";

import { shipments } from "../src/db/schema";
import { buildDemoDataset } from "../src/scoring/demo-seed";
import type { ScriptDb } from "./lib";

/**
 * Seed logic shared by `pnpm seed` and the dev-setup script: turns the
 * 40-scenario synthetic corpus into rows and upserts them by fixed UUID —
 * re-running refreshes demo state instead of duplicating it (the same
 * upsert the in-app "Load the 40-record demo dataset" button uses).
 */
export async function seedDemoDatasetRows(db: ScriptDb): Promise<number> {
  const rows = buildDemoDataset();
  await db
    .insert(shipments)
    .values(rows)
    .onConflictDoUpdate({
      target: shipments.id,
      set: {
        status: sql`excluded.status`,
        intakeData: sql`excluded.intake_data`,
        profile: sql`excluded.profile`,
        scoredAt: sql`excluded.scored_at`,
        confirmedFactors: sql`excluded.confirmed_factors`,
        flaggedFields: sql`excluded.flagged_fields`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  const grouped = await db
    .select({ status: shipments.status, count: sql<number>`count(*)::int` })
    .from(shipments)
    .groupBy(shipments.status);
  for (const entry of grouped) {
    console.log(`  ${entry.status}: ${entry.count}`);
  }
  return rows.length;
}

/** How many shipment rows exist — used by `--if-empty` and dev setup. */
export async function shipmentCount(db: ScriptDb): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shipments);
  return row?.count ?? 0;
}
