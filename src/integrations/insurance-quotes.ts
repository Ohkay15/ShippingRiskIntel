import { envValue, hasEnv } from "./status";
import { PartnerContractPendingError, type EnvSource } from "./types";

/**
 * Insurance quote capability: given a shipment, return an indicative
 * per-shipment cargo premium for covering its declared value (or just its
 * coverage gap).
 *
 * Quotes only — binding always happens in the insurer's own flow. A quote
 * from the mock is labeled "indicative" and must never be presented as an
 * offer.
 */

export interface QuoteRequest {
  shipmentRef: string;
  declaredValueUsd: number;
  /** Amount to insure; defaults to the declared value. */
  insuredAmountUsd?: number;
  cargoDescription: string | null;
  hazardClass: string | null;
  fragilityClass: string | null;
  mode: string | null;
  origin: string | null;
  destination: string | null;
}

export interface InsuranceQuote {
  provider: string;
  /** "indicative" = mock or estimator; "live" = partner-issued quote. */
  kind: "indicative" | "live";
  productName: string;
  insuredAmountUsd: number;
  premiumUsd: number;
  /** Premium per $100 of insured value. */
  ratePer100Usd: number;
  deductibleUsd: number;
  reference: string | null;
  notes: string;
}

export interface InsuranceQuoteProvider {
  readonly id: string;
  quote(req: QuoteRequest): Promise<InsuranceQuote>;
}

// ---------------------------------------------------------------------------
// Indicative estimator (default)
// ---------------------------------------------------------------------------

/** Base rate per $100 by risk driver — illustrative market-style bands. */
function ratePer100(req: QuoteRequest): number {
  let rate = 0.35;
  const hazard = req.hazardClass && req.hazardClass !== "none";
  if (hazard) rate += 0.25;
  if (req.fragilityClass === "high") rate += 0.15;
  if (req.fragilityClass === "ultra") rate += 0.3;
  if (req.mode === "ocean") rate += 0.1;
  if (req.mode === "air") rate -= 0.05;
  return Math.round(rate * 100) / 100;
}

export class IndicativeQuoteProvider implements InsuranceQuoteProvider {
  readonly id = "indicative";
  async quote(req: QuoteRequest): Promise<InsuranceQuote> {
    const insured = Math.max(0, req.insuredAmountUsd ?? req.declaredValueUsd);
    const rate = ratePer100(req);
    const premium = Math.max(35, Math.round((insured / 100) * rate * 100) / 100);
    const deductible = insured >= 250_000 ? 2_500 : insured >= 50_000 ? 1_000 : 500;
    return {
      provider: this.id,
      kind: "indicative",
      productName: "All-risk per-shipment cover (indicative)",
      insuredAmountUsd: insured,
      premiumUsd: premium,
      ratePer100Usd: rate,
      deductibleUsd: deductible,
      reference: null,
      notes:
        "Estimate from an illustrative rate table — not an offer. Connect an insurance partner for a live, bindable quote.",
    };
  }
}

// ---------------------------------------------------------------------------
// Partner adapters (slot + mapping ready; request format pending partner docs)
// ---------------------------------------------------------------------------

/**
 * Neutral payload every insurance partner adapter starts from. Each partner
 * maps it to its own schema once its API contract is shared; until then
 * quote() raises PartnerContractPendingError and the estimator answers.
 */
export function neutralQuotePayload(req: QuoteRequest) {
  return {
    reference: req.shipmentRef,
    cargo: {
      description: req.cargoDescription,
      hazardClass: req.hazardClass,
      fragility: req.fragilityClass,
      value: { amount: req.declaredValueUsd, currency: "USD" },
    },
    coverage: { amount: req.insuredAmountUsd ?? req.declaredValueUsd, currency: "USD" },
    route: { origin: req.origin, destination: req.destination, mode: req.mode },
  };
}

export class PartnerQuoteProvider implements InsuranceQuoteProvider {
  constructor(
    readonly id: string,
    readonly apiKey: string,
    readonly baseUrl: string | undefined
  ) {}
  async quote(_req: QuoteRequest): Promise<InsuranceQuote> {
    throw new PartnerContractPendingError(this.id);
  }
}

const PARTNERS = [
  { id: "loadsure", key: "LOADSURE_API_KEY", url: "LOADSURE_API_URL" },
  { id: "redkik", key: "REDKIK_API_KEY", url: "REDKIK_API_URL" },
  { id: "breeze", key: "BREEZE_API_KEY", url: "BREEZE_API_URL" },
] as const;

/** Partners first (in catalog order), the estimator always last. */
export function getInsuranceQuoteProviders(env: EnvSource): InsuranceQuoteProvider[] {
  const providers: InsuranceQuoteProvider[] = [];
  for (const p of PARTNERS) {
    if (hasEnv(env, [p.key])) {
      providers.push(new PartnerQuoteProvider(p.id, envValue(env, p.key)!, envValue(env, p.url)));
    }
  }
  providers.push(new IndicativeQuoteProvider());
  return providers;
}

/**
 * First provider that answers wins. A partner whose contract is still
 * pending falls through to the next; real upstream failures also fall
 * through, so a quote always comes back (marked indicative when it is).
 */
export async function getInsuranceQuote(req: QuoteRequest, env: EnvSource): Promise<InsuranceQuote> {
  const errors: string[] = [];
  for (const provider of getInsuranceQuoteProviders(env)) {
    try {
      const quote = await provider.quote(req);
      if (errors.length > 0) {
        return { ...quote, notes: `${quote.notes} (${errors.join("; ")})` };
      }
      return quote;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`No insurance quote available: ${errors.join("; ")}`);
}
