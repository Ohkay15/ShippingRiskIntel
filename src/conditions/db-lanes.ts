import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import { displayShipmentId } from "@/dashboard/record-id";
import { shipmentIntakeSchema } from "@/schemas/shipment";
import type { MatrixCell, RiskProfile } from "@/scoring/engine";

import type { NetworkLaneInput } from "./service";

export function toneForCell(cell: MatrixCell | null | undefined): "low" | "elevated" | "high" | null {
  if (!cell) return null;
  if (cell === "HH") return "high";
  if (cell === "LL") return "low";
  return "elevated";
}

/** Lanes for every record that has an origin and destination (newest first, capped). */
export async function lanesFromDb(limit = 200): Promise<NetworkLaneInput[]> {
  const rows = await db
    .select({ id: shipments.id, intakeData: shipments.intakeData, profile: shipments.profile })
    .from(shipments)
    .orderBy(desc(shipments.updatedAt))
    .limit(limit);
  const lanes: NetworkLaneInput[] = [];
  for (const row of rows) {
    const intake = shipmentIntakeSchema.safeParse(row.intakeData);
    if (!intake.success) continue;
    const { origin, destination } = intake.data.route_lane;
    if (!origin || !destination) continue;
    const profile = (row.profile ?? null) as RiskProfile | null;
    lanes.push({
      shipmentId: row.id,
      label: displayShipmentId(row.id),
      origin,
      destination,
      tone: toneForCell(profile?.cell),
    });
  }
  return lanes;
}

export async function laneForShipment(id: string): Promise<{ origin: string | null; destination: string | null } | null> {
  const [row] = await db
    .select({ intakeData: shipments.intakeData })
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);
  if (!row) return null;
  const intake = shipmentIntakeSchema.safeParse(row.intakeData);
  if (!intake.success) return null;
  return { origin: intake.data.route_lane.origin ?? null, destination: intake.data.route_lane.destination ?? null };
}
