/**
 * Removes the synthetic demo shipments (fixed ids 00000000-0000-4000-8000-…)
 * so a deployment only ever shows records people actually entered. Runs on
 * every Vercel build; real records use random UUIDs and are never touched.
 * Set KEEP_DEMO_DATA=true to keep the demo set (e.g. on a sales sandbox).
 */
import { sql } from "drizzle-orm";

import { shipments } from "../src/db/schema";
import { connect, loadEnv } from "./lib";

export const DEMO_ID_PREFIX = "00000000-0000-4000-8000-";

async function main(): Promise<void> {
  if (process.env.KEEP_DEMO_DATA === "true") {
    console.log("KEEP_DEMO_DATA=true — leaving demo shipments in place.");
    return;
  }
  const { db, pool } = connect(loadEnv());
  try {
    const removed = await db
      .delete(shipments)
      .where(sql`${shipments.id}::text like ${DEMO_ID_PREFIX + "%"}`)
      .returning({ id: shipments.id });
    console.log(
      removed.length
        ? `Removed ${removed.length} demo shipment${removed.length === 1 ? "" : "s"} (documents cascade).`
        : "No demo shipments to remove."
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Demo purge failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
