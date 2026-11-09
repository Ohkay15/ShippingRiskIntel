import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import type { FactorKey } from "@/schemas/shipment";
import { shipmentIntakeSchema } from "@/schemas/shipment";
import { DEFAULT_SCORING_CONFIG } from "./config";
import { score, type RiskProfile } from "./engine";

/**
 * The scoring gateway between the record store and the profile store. Runs
 * the pure engine against a stored record and persists the result — the
 * ONLY place that writes profiles or drives the scoring side of the
 * lifecycle (spec: the dashboard reads profiles from storage, and a record
 * never reaches Scored while any factor lacks a basis; records whose
 * factors fell back to conservative defaults land in Needs review instead).
 */

export type ScoredStatus = "scored" | "needs_review";

export interface ScoreOutcome {
  status: ScoredStatus;
  profile: RiskProfile;
}

export async function scoreShipmentRecord(id: string): Promise<ScoreOutcome> {
  const rows = await db
    .select({
      intakeData: shipments.intakeData,
      confirmedFactors: shipments.confirmedFactors,
      status: shipments.status,
    })
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`Cannot score shipment ${id}: record not found.`);
  }

  // Stored JSON is trusted only after it parses against the shared contract
  // — the same boundary rule every reader of intakeData applies.
  const intake = shipmentIntakeSchema.safeParse(row.intakeData);
  if (!intake.success) {
    throw new Error(
      `Cannot score shipment ${id}: stored record failed the shared intake schema.`
    );
  }

  const profile = score(
    intake.data,
    DEFAULT_SCORING_CONFIG,
    new Set(row.confirmedFactors as readonly FactorKey[])
  );
  const status: ScoredStatus = profile.needsReview ? "needs_review" : "scored";

  await db
    .update(shipments)
    .set({ profile, status, scoredAt: new Date(), updatedAt: new Date() })
    .where(eq(shipments.id, id));

  return { status, profile };
}
