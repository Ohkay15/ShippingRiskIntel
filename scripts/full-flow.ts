/**
 * Full-flow pipeline test — the one-pass walkthrough of the whole product:
 *
 *   intake (draft) → document upload → confirm & extract (confidence gate)
 *   → review resolve (accept/correct, re-score) → Scored
 *   → carrier recommendation → pick → Actioned
 *
 * It drives the SAME service functions the UI server actions use
 * (confirmAndExtract, resolveReview, scoreShipmentRecord, markActioned), so
 * a passing run certifies the pipeline end to end. The UI round-trip of
 * each step is manual: run `pnpm dev` beside this and follow the printed
 * step ↔ page mapping if you want to watch it in the browser.
 *
 *   pnpm fullflow
 *
 * The run uses one fixed record (SH-990) so it is idempotent: re-running
 * replaces it, and it stays around afterwards as a worked example you can
 * open in the dashboard.
 */
import { eq } from "drizzle-orm";

import { confirmAndExtract } from "../src/extraction/confirmation";
import { SAMPLE_COMMERCIAL_INVOICE } from "../src/llm/fixtures";
import { markActioned } from "../src/lifecycle/actioned";
import { PLACEHOLDER_CARRIER_FIT_MATRIX } from "../src/carriers/matrix-data";
import { recommendCarriers } from "../src/carriers/recommend";
import { resolveReview } from "../src/review/resolution";
import { FACTOR_KEYS, shipmentIntakeSchema, type FactorKey } from "../src/schemas/shipment";
import { shipmentDocuments, shipments } from "../src/db/schema";
import { demoShipmentUuid } from "../src/scoring/demo-seed";
import { assert, connect, fail, loadEnv, step } from "./lib";

const FLOW_ID = demoShipmentUuid("SH-990");
const FLOW_LABEL = "SH-990 full-flow record";

async function main(): Promise<void> {
  const { db, pool } = connect(loadEnv());

  try {
    step(1, "Reset: remove any previous full-flow record (fixed id SH-990)");
    await db.delete(shipments).where(eq(shipments.id, FLOW_ID));
    console.log("  ok: clean slate");

    step(2, "Intake: create a draft record (as the intake form does)");
    // The form inserts a validated (possibly partial) payload; an empty
    // payload is the document-first path — details arrive from extraction.
    const draft = shipmentIntakeSchema.parse({});
    await db.insert(shipments).values({
      id: FLOW_ID,
      status: "draft",
      intakeData: draft,
    });
    assert((await statusOf(db)) === "draft", "record created in Draft");

    step(3, "Upload: attach a commercial invoice (no extraction yet)");
    // uploadDocument persists exactly this: kind + filename + verbatim text.
    await db.insert(shipmentDocuments).values({
      shipmentId: FLOW_ID,
      kind: "commercial_invoice",
      filename: "sample-commercial-invoice.txt",
      mimeType: "text/plain",
      rawText: SAMPLE_COMMERCIAL_INVOICE,
    });
    console.log("  ok: invoice stored — the record was NOT scored (upload never auto-scores)");

    step(4, "Confirm & extract: LLM extraction + 0.75 confidence gate");
    const confirmation = await confirmAndExtract(FLOW_ID);
    if (!confirmation.ok) fail(`confirm & extract refused: ${confirmation.message}`);
    assert(confirmation.providerName === "mock", `extraction ran (provider: ${confirmation.providerName})`);
    const afterExtract = await recordOf(db);
    assert(afterExtract.status === "needs_review", "record routed to Needs review");
    assert(
      (afterExtract.flaggedFields?.length ?? 0) === confirmation.flaggedCount,
      `${confirmation.flaggedCount} field(s) flagged below the confidence gate`
    );
    assert(confirmation.flaggedCount > 0, "the gate flagged at least one field (unNumber is absent from the invoice)");

    step(5, "Review resolve: accept flagged factors at their conservative default");
    const resolution = await resolveReview(
      FLOW_ID,
      {},
      [...FACTOR_KEYS] // the queue's "leave unknown, accept the default" path
    );
    if (!resolution.ok) fail(`review resolve refused: ${resolution.message} ${JSON.stringify(resolution.fieldErrors)}`);
    const afterResolve = await recordOf(db);
    assert(afterResolve.status === "scored", "re-score landed the record in Scored (no silent guesses remain)");
    if (!afterResolve.profile) fail("Scored record has no stored profile");
    console.log(
      `  ok: composite ${afterResolve.profile.score} in cell ${afterResolve.profile.cell}, coverage gap ${
        afterResolve.profile.coverageGapUsd == null ? "unknown" : `$${afterResolve.profile.coverageGapUsd}`
      }`
    );

    step(6, "Carrier recommendations: fit matrix + projected score deltas");
    const intake = shipmentIntakeSchema.parse(afterResolve.intakeData);
    const recommendations = recommendCarriers(
      intake,
      afterResolve.profile,
      PLACEHOLDER_CARRIER_FIT_MATRIX,
      new Set(afterResolve.confirmedFactors as readonly FactorKey[])
    );
    assert(recommendations.length > 0, "at least one carrier fits this record");
    for (const rec of recommendations) {
      console.log(
        `  · ${rec.carrier.name} (${rec.carrier.id}): projected ${rec.projectedProfile.score} (${rec.scoreDelta >= 0 ? "+" : ""}${rec.scoreDelta})`
      );
    }

    step(7, "Pick the top recommendation: Scored → Actioned");
    const top = recommendations[0];
    const actioned = await markActioned(FLOW_ID, top.carrier.id);
    if (!actioned.ok) fail(`pick refused: ${actioned.message}`);
    const final = await recordOf(db);
    assert(final.status === "actioned", "record is Actioned");
    assert(final.actionedCarrierId === top.carrier.id, `carrier ${top.carrier.name} recorded`);
    assert(final.projectedProfile != null, "post-action projected position stored");

    console.log(
      `\nPASS — the full pipeline works end to end. Start \`pnpm dev\` and open http://localhost:3000/shipments/${FLOW_ID} to see the Actioned record.`
    );
    process.exit(0);
  } finally {
    await pool.end();
  }
}

async function recordOf(db: ReturnType<typeof connect>["db"]) {
  const [row] = await db.select().from(shipments).where(eq(shipments.id, FLOW_ID)).limit(1);
  if (!row) fail(`${FLOW_LABEL} disappeared from the database`);
  return row;
}

async function statusOf(db: ReturnType<typeof connect>["db"]) {
  return (await recordOf(db)).status;
}

main().catch((error) => {
  console.error(
    `\nFull-flow test failed: ${error instanceof Error ? error.message : String(error)}`
  );
  console.error("Is Postgres running? Start it with `docker compose up -d`, and run `pnpm dev` once to apply the schema (or `pnpm db:push`).");
  process.exit(1);
});
