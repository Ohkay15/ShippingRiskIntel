import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import type { ShipmentStatus } from "@/db/lifecycle";
import { canTransition } from "@/lifecycle/machine";
import {
  buildActionedProjectionFromPicks,
  type PicksActionedProjection,
} from "@/lifecycle/actioned-projection";
import type { FactorKey } from "@/schemas/shipment";
import { shipmentIntakeSchema } from "@/schemas/shipment";
import { emitRiskEvent } from "@/integrations/publish";

export type ActionedOutcome =
  | { ok: true; status: ShipmentStatus; projection: PicksActionedProjection }
  | { ok: false; message: string };

/** Either pick — or both — can complete the Scored → Actioned transition. */
export interface ActionedPickRequest {
  carrierRecommendationId?: string | null;
  insuranceProductId?: string | null;
}

/**
 * The Scored → Actioned transition (spec state table: "Profile locked with
 * chosen carrier; post-action score"). The guard is real: only a Scored
 * record can be actioned, at least one pick is required, and every pick
 * must exist in its fit matrix and match the record. A carrier pick, an
 * insurance product pick, or both may be recorded on the record in one
 * transition. The projection is the pure engine re-scoring the record with
 * the picks' attributes substituted — stored alongside the record; the
 * record's own data is never mutated.
 */
export async function markActioned(id: string, picks: ActionedPickRequest): Promise<ActionedOutcome> {
  const carrierRecommendationId = picks.carrierRecommendationId?.trim() || null;
  const insuranceProductId = picks.insuranceProductId?.trim() || null;

  if (!carrierRecommendationId && !insuranceProductId) {
    return {
      ok: false,
      message: "A carrier or insurance product pick is required to action a record.",
    };
  }

  const [record] = await db
    .select({
      status: shipments.status,
      intakeData: shipments.intakeData,
      profile: shipments.profile,
      confirmedFactors: shipments.confirmedFactors,
    })
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);

  if (!record) {
    return { ok: false, message: "Record not found. It may have been deleted." };
  }
  if (!canTransition(record.status, "actioned")) {
    return {
      ok: false,
      message: `Record is ${record.status}; only scored records can be actioned.`,
    };
  }
  if (!record.profile) {
    return {
      ok: false,
      message: "Record has no stored profile; score it before actioning.",
    };
  }

  // Stored JSON is trusted only after it parses against the shared contract
  // — the same boundary rule every reader of intakeData applies.
  const intake = shipmentIntakeSchema.safeParse(record.intakeData);
  if (!intake.success) {
    return {
      ok: false,
      message: "The stored record failed validation and cannot be actioned.",
    };
  }

  const outcome = buildActionedProjectionFromPicks(
    intake.data,
    record.profile,
    { carrierId: carrierRecommendationId, insuranceProductId },
    new Set(record.confirmedFactors as readonly FactorKey[])
  );
  if (!outcome.ok) {
    return { ok: false, message: outcome.message };
  }

  const { projection } = outcome;
  await db
    .update(shipments)
    .set({
      status: "actioned",
      actionedCarrierId: projection.carrier?.id ?? null,
      actionedInsuranceProductId: projection.insuranceProduct?.id ?? null,
      projectedProfile: projection.projectedProfile,
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, id));

  await emitRiskEvent("shipment.actioned", id, intake.data, projection.projectedProfile);

  return { ok: true, status: "actioned", projection };
}
