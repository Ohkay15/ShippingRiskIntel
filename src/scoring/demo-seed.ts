import type { ShipmentStatus } from "../db/lifecycle";
import type { FactorKey, ShipmentIntake } from "../schemas/shipment";
import { scoreSyntheticDataset, syntheticShipments } from "./dataset";
import type { RiskProfile } from "./engine";

/**
 * The demo dataset loader's pure half: turns the 40-scenario synthetic
 * corpus into complete shipment rows — profiles computed, statuses routed
 * by the same gateway rule the live app uses (a profile with review flags
 * parks in needs_review; everything else is Scored). Seeding inserts these
 * verbatim, so a seeded dashboard and a hand-driven one are the same thing.
 *
 * Records use fixed UUIDs derived from their dataset id (SH-001 … SH-040),
 * making the seed idempotent: re-running upserts the same rows instead of
 * duplicating them.
 */

/** Fixed base instant — deterministic timestamps, stable list ordering. */
const BASE_TIME = Date.parse("2026-11-01T09:00:00.000Z");

export interface DemoShipmentRow {
  id: string;
  status: ShipmentStatus;
  intakeData: ShipmentIntake;
  profile: RiskProfile;
  confirmedFactors: FactorKey[];
  createdAt: Date;
  updatedAt: Date;
  scoredAt: Date;
}

/** SH-001 → 00000000-0000-4000-8000-000000000001 (valid, fixed, sortable). */
export function demoShipmentUuid(syntheticId: string): string {
  const numeric = Number(syntheticId.replace("SH-", ""));
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 999) {
    throw new Error(`Malformed synthetic dataset id: ${syntheticId}`);
  }
  return `00000000-0000-4000-8000-${String(numeric).padStart(12, "0")}`;
}

export function buildDemoDataset(): DemoShipmentRow[] {
  const scored = scoreSyntheticDataset();
  return scored.map((entry, index) => {
    const createdAt = new Date(BASE_TIME + index * 60_000);
    const scoredAt = new Date(BASE_TIME + index * 60_000 + 30_000);
    return {
      id: demoShipmentUuid(entry.id),
      status: entry.profile.needsReview ? "needs_review" : "scored",
      intakeData: entry.record,
      profile: entry.profile,
      confirmedFactors: [],
      createdAt,
      updatedAt: scoredAt,
      scoredAt,
    };
  });
}

/** The synthetic corpus, for labels in UI (id → scenario intent). */
export function demoDatasetLabels(): ReadonlyMap<string, string> {
  return new Map(syntheticShipments.map((s) => [s.id, s.label]));
}
