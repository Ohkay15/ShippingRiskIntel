import { requestJson, type FetchLike } from "./http";
import { envValue, hasEnv } from "./status";
import type { EnvSource } from "./types";

/**
 * Carrier data capability: public safety record for a US motor carrier,
 * normalized to the engine's 1–5 safety-rating scale (1 = safest).
 *
 * Live: FMCSA QCMobile (free web key). Fallback: deterministic mock keyed
 * on the DOT number, clearly labeled as sample data.
 */

export interface CarrierSafetySnapshot {
  source: "fmcsa" | "mock";
  dotNumber: string;
  legalName: string | null;
  allowedToOperate: boolean | null;
  /** FMCSA rating letter: S(atisfactory), C(onditional), U(nsatisfactory), or null when unrated. */
  fmcsaRating: "S" | "C" | "U" | null;
  driverOosRatePct: number | null;
  driverOosNationalAvgPct: number | null;
  vehicleOosRatePct: number | null;
  vehicleOosNationalAvgPct: number | null;
  powerUnits: number | null;
  /** Engine-scale suggestion (1 best … 5 worst) with the reason it was chosen. */
  suggestedSafetyRating: 1 | 2 | 3 | 4 | 5;
  ratingReason: string;
}

export interface CarrierDataProvider {
  readonly id: string;
  lookupByDot(dotNumber: string): Promise<CarrierSafetySnapshot>;
}

const DOT_PATTERN = /^\d{1,8}$/;

export function normalizeDot(raw: string): string | null {
  const digits = raw.replace(/^(us)?dot[#:\s-]*/i, "").trim();
  return DOT_PATTERN.test(digits) ? digits : null;
}

/**
 * Map FMCSA facts onto the engine's 1–5 scale. Order matters: authority and
 * an explicit FMCSA rating dominate; out-of-service rates relative to the
 * national average decide the rest; no data at all is a neutral 3, never 1.
 */
export function suggestSafetyRating(input: {
  allowedToOperate: boolean | null;
  fmcsaRating: "S" | "C" | "U" | null;
  driverOosRatePct: number | null;
  driverOosNationalAvgPct: number | null;
  vehicleOosRatePct: number | null;
  vehicleOosNationalAvgPct: number | null;
}): { rating: 1 | 2 | 3 | 4 | 5; reason: string } {
  if (input.allowedToOperate === false) {
    return { rating: 5, reason: "Not authorized to operate per FMCSA." };
  }
  if (input.fmcsaRating === "U") return { rating: 5, reason: "FMCSA rating: Unsatisfactory." };
  if (input.fmcsaRating === "C") return { rating: 4, reason: "FMCSA rating: Conditional." };

  const ratios: number[] = [];
  if (input.driverOosRatePct != null && input.driverOosNationalAvgPct) {
    ratios.push(input.driverOosRatePct / input.driverOosNationalAvgPct);
  }
  if (input.vehicleOosRatePct != null && input.vehicleOosNationalAvgPct) {
    ratios.push(input.vehicleOosRatePct / input.vehicleOosNationalAvgPct);
  }
  if (ratios.length === 0) {
    return input.fmcsaRating === "S"
      ? { rating: 2, reason: "FMCSA rating: Satisfactory; no out-of-service data." }
      : { rating: 3, reason: "No FMCSA rating or out-of-service data — neutral default." };
  }
  const worst = Math.max(...ratios);
  const pct = Math.round(worst * 100);
  if (worst <= 0.5) return { rating: 1, reason: `Out-of-service rate at ${pct}% of national average.` };
  if (worst <= 1) return { rating: 2, reason: `Out-of-service rate at ${pct}% of national average.` };
  if (worst <= 1.5) return { rating: 3, reason: `Out-of-service rate at ${pct}% of national average.` };
  return { rating: 4, reason: `Out-of-service rate at ${pct}% of national average.` };
}

// ---------------------------------------------------------------------------
// FMCSA QCMobile (live)
// ---------------------------------------------------------------------------

interface FmcsaCarrierResponse {
  content?: {
    carrier?: {
      legalName?: string | null;
      allowedToOperate?: string | null;
      safetyRating?: string | null;
      driverOosRate?: number | null;
      driverOosRateNationalAverage?: string | number | null;
      vehicleOosRate?: number | null;
      vehicleOosRateNationalAverage?: string | number | null;
      totalPowerUnits?: number | null;
    } | null;
  } | null;
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export class FmcsaCarrierDataProvider implements CarrierDataProvider {
  readonly id = "fmcsa";
  constructor(
    private readonly webKey: string,
    private readonly fetchImpl?: FetchLike
  ) {}

  async lookupByDot(dotNumber: string): Promise<CarrierSafetySnapshot> {
    const dot = normalizeDot(dotNumber);
    if (!dot) throw new Error(`"${dotNumber}" is not a valid US DOT number.`);
    const data = await requestJson<FmcsaCarrierResponse>({
      connectorId: this.id,
      url: `https://mobile.fmcsa.dot.gov/qc/services/carriers/${dot}?webKey=${encodeURIComponent(this.webKey)}`,
      fetchImpl: this.fetchImpl,
    });
    const c = data.content?.carrier;
    if (!c) throw new Error(`No FMCSA record for DOT ${dot}.`);
    const rating = c.safetyRating === "S" || c.safetyRating === "C" || c.safetyRating === "U" ? c.safetyRating : null;
    const facts = {
      allowedToOperate: c.allowedToOperate == null ? null : c.allowedToOperate === "Y",
      fmcsaRating: rating,
      driverOosRatePct: num(c.driverOosRate),
      driverOosNationalAvgPct: num(c.driverOosRateNationalAverage),
      vehicleOosRatePct: num(c.vehicleOosRate),
      vehicleOosNationalAvgPct: num(c.vehicleOosRateNationalAverage),
    } as const;
    const suggestion = suggestSafetyRating(facts);
    return {
      source: "fmcsa",
      dotNumber: dot,
      legalName: c.legalName ?? null,
      ...facts,
      powerUnits: num(c.totalPowerUnits),
      suggestedSafetyRating: suggestion.rating,
      ratingReason: suggestion.reason,
    };
  }
}

// ---------------------------------------------------------------------------
// Mock (default)
// ---------------------------------------------------------------------------

export class MockCarrierDataProvider implements CarrierDataProvider {
  readonly id = "mock";
  async lookupByDot(dotNumber: string): Promise<CarrierSafetySnapshot> {
    const dot = normalizeDot(dotNumber);
    if (!dot) throw new Error(`"${dotNumber}" is not a valid US DOT number.`);
    const seed = [...dot].reduce((sum, d) => sum + Number(d), 0);
    const facts = {
      allowedToOperate: seed % 11 !== 0,
      fmcsaRating: (["S", null, "S", "C"] as const)[seed % 4] ?? null,
      driverOosRatePct: 2 + (seed % 9),
      driverOosNationalAvgPct: 6.7,
      vehicleOosRatePct: 10 + (seed % 25),
      vehicleOosNationalAvgPct: 22.3,
    };
    const suggestion = suggestSafetyRating(facts);
    return {
      source: "mock",
      dotNumber: dot,
      legalName: `Sample Carrier ${dot}`,
      ...facts,
      powerUnits: 5 + (seed % 40) * 3,
      suggestedSafetyRating: suggestion.rating,
      ratingReason: `${suggestion.reason} (sample data — add FMCSA_WEB_KEY for live records)`,
    };
  }
}

export function getCarrierDataProvider(env: EnvSource, fetchImpl?: FetchLike): CarrierDataProvider {
  if (hasEnv(env, ["FMCSA_WEB_KEY"])) {
    return new FmcsaCarrierDataProvider(envValue(env, "FMCSA_WEB_KEY")!, fetchImpl);
  }
  return new MockCarrierDataProvider();
}
