import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import type { ShipmentStatus } from "@/db/lifecycle";
import { canTransition } from "@/lifecycle/machine";

export type ActionedOutcome =
  | { ok: true; status: ShipmentStatus }
  | { ok: false; message: string };

/**
 * The Scored → Actioned transition, typed for the carrier fit matrix that
 * lands in the next milestone. Carrier matching is deliberately NOT
 * implemented here — the recommendation UI will call this with the chosen
 * recommendation's id and a post-action projection. The transition guard
 * is real: only a Scored record can be actioned, and a carrier id is
 * required — the state machine never moves on a vague "done".
 */
export async function markActioned(
  id: string,
  carrierRecommendationId: string
): Promise<ActionedOutcome> {
  if (!carrierRecommendationId.trim()) {
    return {
      ok: false,
      message: "A carrier recommendation id is required to action a record.",
    };
  }

  const [record] = await db
    .select({ status: shipments.status })
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

  await db
    .update(shipments)
    .set({ status: "actioned", updatedAt: new Date() })
    .where(eq(shipments.id, id));

  return { ok: true, status: "actioned" };
}
