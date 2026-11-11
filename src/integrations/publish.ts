import { publishRiskEvent, type RiskEvent, type RiskEventType } from "./events";
import { envValue, processEnv } from "./status";
import type { ShipmentIntake } from "@/schemas/shipment";
import type { RiskProfile } from "@/scoring/engine";
import type { EnvSource } from "./types";

/** Public base URL for deep links in outbound events. */
export function appBaseUrl(env: EnvSource): string | null {
  const explicit = envValue(env, "APP_BASE_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = envValue(env, "VERCEL_PROJECT_PRODUCTION_URL");
  return vercel ? `https://${vercel}` : null;
}

export function buildRiskEvent(
  type: RiskEventType,
  shipmentId: string,
  intake: ShipmentIntake,
  profile: RiskProfile,
  env: EnvSource,
  now: Date = new Date()
): RiskEvent {
  const base = appBaseUrl(env);
  return {
    type,
    shipmentId,
    shipmentUrl: base ? `${base}/shipments/${shipmentId}` : null,
    occurredAt: now.toISOString(),
    summary: {
      cargoDescription: intake.cargo_hazard.cargoDescription ?? null,
      lane: intake.route_lane.laneId ?? null,
      // The intake contract has no shipper field yet; CRM matching activates
      // once one is added (the HubSpot sink skips events without a name).
      accountName: null,
      score: profile.score,
      cell: profile.cell,
      coverageGapUsd: profile.coverageGapUsd,
      declaredValueUsd: intake.value_fragility.declaredValueUsd ?? null,
      needsReview: profile.needsReview,
    },
  };
}

/**
 * Emit a risk event to every connected sink. Never throws and never blocks
 * for long: with no sinks configured it returns immediately, and each sink
 * has its own timeout.
 */
export async function emitRiskEvent(
  type: RiskEventType,
  shipmentId: string,
  intake: ShipmentIntake,
  profile: RiskProfile
): Promise<void> {
  try {
    const env = processEnv();
    const results = await publishRiskEvent(buildRiskEvent(type, shipmentId, intake, profile, env), env);
    for (const r of results) {
      if (!r.ok) console.warn(`[integrations] ${r.sink} failed: ${r.error}`);
    }
  } catch (error) {
    console.warn("[integrations] event publish failed", error);
  }
}
