/**
 * Timing check — the roadmap's deck metric: a shipment scored within 30
 * seconds of intake ("record-to-profile").
 *
 * For every record in the 40-scenario synthetic dataset this script drives
 * the real pipeline headlessly and measures wall-clock time from a
 * submitted draft record to a stored Scored profile:
 *
 *   draft insert (intake) → document upload → confirm & extract
 *   → review resolve (accept flagged at default) → re-score → Scored
 *
 * What the number IS: machine time of the full pipeline, including the LLM
 * extraction round-trip (the deterministic mock — instant, no network).
 * What it is NOT: the operator's own reading/decision time at the review
 * step, or live-provider latency. Both stack on top; see README.
 *
 *   pnpm timing
 *
 * Measurement records use fixed ids (SH-950+) and are deleted afterwards —
 * the demo dataset is left untouched.
 */
import { eq, inArray } from "drizzle-orm";

import { confirmAndExtract } from "../src/extraction/confirmation";
import { resolveReview } from "../src/review/resolution";
import { shipmentDocuments, shipments } from "../src/db/schema";
import { SAMPLE_COMMERCIAL_INVOICE } from "../src/llm/fixtures";
import { demoShipmentUuid } from "../src/scoring/demo-seed";
import { scoreSyntheticDataset } from "../src/scoring/dataset";
import { FACTOR_KEYS } from "../src/schemas/shipment";
import { connect, loadEnv } from "./lib";

const ID_OFFSET = 950; // SH-950 … SH-989 — disjoint from the seed (SH-001 … SH-040)

interface Sample {
  id: string;
  label: string;
  ms: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function main(): Promise<void> {
  const { db, pool } = connect(loadEnv());
  const scenarios = scoreSyntheticDataset();

  try {
    console.log(
      `Timing intake → scored across ${scenarios.length} records (mock provider, local Postgres)…\n`
    );
    const samples: Sample[] = [];

    for (const [index, scenario] of scenarios.entries()) {
      const id = demoShipmentUuid(`SH-${ID_OFFSET + index + 1}`);
      await db.delete(shipments).where(eq(shipments.id, id));

      // Intake: the operator submits the record (draft).
      await db.insert(shipments).values({
        id,
        status: "draft",
        intakeData: scenario.record,
      });
      // Upload: the source document is stored verbatim.
      await db.insert(shipmentDocuments).values({
        shipmentId: id,
        kind: "commercial_invoice",
        filename: "timing-invoice.txt",
        mimeType: "text/plain",
        rawText: SAMPLE_COMMERCIAL_INVOICE,
      });

      const started = performance.now();
      const confirmation = await confirmAndExtract(id);
      if (!confirmation.ok) {
        throw new Error(`confirm & extract failed for ${scenario.id}: ${confirmation.message}`);
      }
      const resolution = await resolveReview(id, {}, [...FACTOR_KEYS]);
      if (!resolution.ok) {
        throw new Error(`review resolve failed for ${scenario.id}: ${resolution.message}`);
      }
      const [row] = await db
        .select({ status: shipments.status })
        .from(shipments)
        .where(eq(shipments.id, id))
        .limit(1);
      if (row?.status !== "scored") {
        throw new Error(`${scenario.id} landed in ${row?.status ?? "unknown"} instead of scored`);
      }
      samples.push({ id, label: scenario.id, ms: performance.now() - started });

      // Success path cleans up per record; the finally block below is the
      // safety net for mid-loop failures. Documents cascade with the row.
      await db.delete(shipments).where(eq(shipments.id, id));
    }

    const times = samples.map((s) => s.ms).sort((a, b) => a - b);
    const slowest = [...samples].sort((a, b) => b.ms - a.ms)[0];
    const totalMs = times.reduce((sum, ms) => sum + ms, 0);

    console.log("Intake → scored latency per record:");
    console.log(`  records : ${times.length}`);
    console.log(`  min     : ${times[0].toFixed(1)} ms`);
    console.log(`  p50     : ${percentile(times, 50).toFixed(1)} ms`);
    console.log(`  p95     : ${percentile(times, 95).toFixed(1)} ms`);
    console.log(`  max     : ${times[times.length - 1].toFixed(1)} ms (${slowest.label})`);
    console.log(`  mean    : ${(totalMs / times.length).toFixed(1)} ms`);
    console.log(
      `\nDeck metric — 30-second record-to-profile: ${
        times[times.length - 1] < 30_000 ? "PASS" : "FAIL"
      } (slowest record ${slowest.label} at ${(times[times.length - 1] / 1000).toFixed(2)} s)`
    );
  } finally {
    // Safety net for mid-loop failures: measurement rows are deleted even
    // on error (fixed id range, documents cascade with them). On the
    // success path the rows are already gone.
    const ids = scenarios.map((_, index) => demoShipmentUuid(`SH-${ID_OFFSET + index + 1}`));
    await db.delete(shipments).where(inArray(shipments.id, ids));
    await pool.end();
  }
}

main()
  .then(() => {
    // The pipeline services hold their own lazy pool; close the process
    // explicitly once measurement rows are cleaned up.
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      `\nTiming check failed: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error("Is Postgres running? Start it with `docker compose up -d`, and run `pnpm dev` once to apply the schema (or `pnpm db:push`).");
    process.exit(1);
  });
