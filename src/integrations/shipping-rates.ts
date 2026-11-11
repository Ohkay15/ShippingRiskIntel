import { requestJson, type FetchLike } from "./http";
import { envValue, hasEnv } from "./status";
import type { EnvSource } from "./types";

/**
 * Parcel rate capability: compare carrier rates for a parcel between two
 * US ZIP codes. Live: EasyPost. Fallback: deterministic sample rates.
 */

export interface RateRequest {
  fromZip: string;
  toZip: string;
  weightOz: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
}

export interface ParcelRate {
  carrier: string;
  service: string;
  rateUsd: number;
  deliveryDays: number | null;
}

export interface RateQuoteResult {
  source: "easypost" | "sample";
  rates: ParcelRate[];
}

export interface ShippingRateProvider {
  readonly id: string;
  rates(req: RateRequest): Promise<RateQuoteResult>;
}

interface EasyPostShipment {
  rates?: { carrier: string; service: string; rate: string; delivery_days: number | null }[];
}

export class EasyPostRateProvider implements ShippingRateProvider {
  readonly id = "easypost";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl?: FetchLike
  ) {}
  async rates(req: RateRequest): Promise<RateQuoteResult> {
    const auth = Buffer.from(`${this.apiKey}:`).toString("base64");
    const shipment = await requestJson<EasyPostShipment>({
      connectorId: this.id,
      url: "https://api.easypost.com/v2/shipments",
      headers: { Authorization: `Basic ${auth}` },
      body: {
        shipment: {
          from_address: { zip: req.fromZip, country: "US" },
          to_address: { zip: req.toZip, country: "US" },
          parcel: {
            weight: req.weightOz,
            length: req.lengthIn,
            width: req.widthIn,
            height: req.heightIn,
          },
        },
      },
      fetchImpl: this.fetchImpl,
    });
    const rates = (shipment.rates ?? [])
      .map((r) => ({
        carrier: r.carrier,
        service: r.service,
        rateUsd: Number.parseFloat(r.rate),
        deliveryDays: r.delivery_days ?? null,
      }))
      .filter((r) => Number.isFinite(r.rateUsd))
      .sort((a, b) => a.rateUsd - b.rateUsd);
    return { source: "easypost", rates };
  }
}

export class SampleRateProvider implements ShippingRateProvider {
  readonly id = "sample";
  async rates(req: RateRequest): Promise<RateQuoteResult> {
    const lbs = Math.max(1, req.weightOz / 16);
    const distance = Math.abs(Number(req.fromZip.slice(0, 3)) - Number(req.toZip.slice(0, 3))) || 50;
    const base = 6 + lbs * 0.9 + distance / 120;
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      source: "sample",
      rates: [
        { carrier: "Carrier A", service: "Ground", rateUsd: round(base), deliveryDays: 5 },
        { carrier: "Carrier B", service: "Ground Economy", rateUsd: round(base * 0.92), deliveryDays: 6 },
        { carrier: "Carrier A", service: "2-Day", rateUsd: round(base * 2.1), deliveryDays: 2 },
        { carrier: "Carrier C", service: "Overnight", rateUsd: round(base * 3.6), deliveryDays: 1 },
      ].sort((a, b) => a.rateUsd - b.rateUsd),
    };
  }
}

export function getShippingRateProvider(env: EnvSource, fetchImpl?: FetchLike): ShippingRateProvider {
  if (hasEnv(env, ["EASYPOST_API_KEY"])) {
    return new EasyPostRateProvider(envValue(env, "EASYPOST_API_KEY")!, fetchImpl);
  }
  return new SampleRateProvider();
}
