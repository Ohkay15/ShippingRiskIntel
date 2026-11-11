import { describe, expect, it } from "vitest";

import { CONNECTORS } from "./catalog";
import {
  FmcsaCarrierDataProvider,
  getCarrierDataProvider,
  MockCarrierDataProvider,
  normalizeDot,
  suggestSafetyRating,
} from "./carrier-data";
import {
  ChatWebhookSink,
  eventHeadline,
  getEventSinks,
  HubSpotSink,
  isAlertWorthy,
  OutboundWebhookSink,
  publishRiskEvent,
  signPayload,
  type RiskEvent,
} from "./events";
import { bearerMatches, parseInboundLoad } from "./inbound";
import { getInsuranceQuote, getInsuranceQuoteProviders, type QuoteRequest } from "./insurance-quotes";
import { connectorStatus, integrationStatusReport, statusCounts } from "./status";
import { getShippingRateProvider, SampleRateProvider } from "./shipping-rates";

/** Fake fetch that records calls and answers from a script. */
function fakeFetch(responder: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body } = responder(url, init);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { impl, calls };
}

const EVENT: RiskEvent = {
  type: "shipment.scored",
  shipmentId: "abc",
  shipmentUrl: "https://app.example/shipments/abc",
  occurredAt: "2026-11-11T00:00:00.000Z",
  summary: {
    cargoDescription: "Lithium batteries",
    lane: "US-CA-TX-02",
    accountName: "Acme Freight",
    score: 13.1,
    cell: "HH",
    coverageGapUsd: 90000,
    declaredValueUsd: 180000,
    needsReview: false,
  },
};

describe("catalog", () => {
  it("has unique ids; only always-on connectors skip env vars", () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keyless = CONNECTORS.filter((c) => c.requiredEnv.length === 0).map((c) => c.id);
    expect(keyless).toEqual(["mcp"]);
  });

  it("derives status from the environment", () => {
    const hubspot = CONNECTORS.find((c) => c.id === "hubspot")!;
    const loadsure = CONNECTORS.find((c) => c.id === "loadsure")!;
    const stripe = CONNECTORS.find((c) => c.id === "stripe")!;
    expect(connectorStatus(hubspot, {})).toBe("add_key");
    expect(connectorStatus(hubspot, { HUBSPOT_ACCESS_TOKEN: "x" })).toBe("connected");
    expect(connectorStatus(hubspot, { HUBSPOT_ACCESS_TOKEN: "   " })).toBe("add_key");
    expect(connectorStatus(loadsure, {})).toBe("partner_access");
    expect(connectorStatus(loadsure, { LOADSURE_API_KEY: "k" })).toBe("keys_set_pending_contract");
    expect(connectorStatus(stripe, { STRIPE_SECRET_KEY: "a", STRIPE_WEBHOOK_SECRET: "b" })).toBe("planned");
  });

  it("reports missing env vars and counts", () => {
    const report = integrationStatusReport({ SLACK_WEBHOOK_URL: "https://hooks.example" });
    const slack = report.flatMap((g) => g.connectors).find((c) => c.def.id === "slack")!;
    expect(slack.status).toBe("connected");
    expect(slack.missingEnv).toEqual([]);
    expect(statusCounts(report).connected).toBe(2); // slack + always-on MCP
  });
});

describe("carrier data", () => {
  it("normalizes DOT numbers", () => {
    expect(normalizeDot("USDOT 1234567")).toBe("1234567");
    expect(normalizeDot("dot#42")).toBe("42");
    expect(normalizeDot("MC-1234")).toBeNull();
  });

  it("maps FMCSA facts onto the 1–5 scale, worst signal first", () => {
    const base = { driverOosRatePct: null, driverOosNationalAvgPct: null, vehicleOosRatePct: null, vehicleOosNationalAvgPct: null };
    expect(suggestSafetyRating({ ...base, allowedToOperate: false, fmcsaRating: "S" }).rating).toBe(5);
    expect(suggestSafetyRating({ ...base, allowedToOperate: true, fmcsaRating: "C" }).rating).toBe(4);
    expect(suggestSafetyRating({ ...base, allowedToOperate: true, fmcsaRating: null }).rating).toBe(3);
    expect(
      suggestSafetyRating({ allowedToOperate: true, fmcsaRating: null, driverOosRatePct: 2, driverOosNationalAvgPct: 6, vehicleOosRatePct: 5, vehicleOosNationalAvgPct: 22 }).rating
    ).toBe(1);
    expect(
      suggestSafetyRating({ allowedToOperate: true, fmcsaRating: null, driverOosRatePct: 12, driverOosNationalAvgPct: 6, vehicleOosRatePct: 5, vehicleOosNationalAvgPct: 22 }).rating
    ).toBe(4);
  });

  it("uses the mock without a key and FMCSA with one", async () => {
    expect(getCarrierDataProvider({})).toBeInstanceOf(MockCarrierDataProvider);
    const { impl, calls } = fakeFetch(() => ({
      body: {
        content: {
          carrier: {
            legalName: "Test Haulers",
            allowedToOperate: "Y",
            safetyRating: "S",
            driverOosRate: 3,
            driverOosRateNationalAverage: "6.67",
            vehicleOosRate: 10,
            vehicleOosRateNationalAverage: "22.26",
            totalPowerUnits: 40,
          },
        },
      },
    }));
    const provider = getCarrierDataProvider({ FMCSA_WEB_KEY: "key" }, impl);
    expect(provider).toBeInstanceOf(FmcsaCarrierDataProvider);
    const snap = await provider.lookupByDot("1234567");
    expect(calls[0]!.url).toContain("/qc/services/carriers/1234567?webKey=key");
    expect(snap).toMatchObject({ source: "fmcsa", legalName: "Test Haulers", allowedToOperate: true, suggestedSafetyRating: 1 });
  });

  it("mock data is deterministic and labeled", async () => {
    const a = await new MockCarrierDataProvider().lookupByDot("1234567");
    const b = await new MockCarrierDataProvider().lookupByDot("1234567");
    expect(a).toEqual(b);
    expect(a.ratingReason).toContain("sample data");
  });
});

describe("insurance quotes", () => {
  const req: QuoteRequest = {
    shipmentRef: "SH-001",
    declaredValueUsd: 100000,
    insuredAmountUsd: 40000,
    cargoDescription: "Acetone",
    hazardClass: "3",
    fragilityClass: "low",
    mode: "road",
    origin: null,
    destination: null,
  };

  it("falls back to the indicative estimator and says why", async () => {
    expect(getInsuranceQuoteProviders({}).map((p) => p.id)).toEqual(["indicative"]);
    const quote = await getInsuranceQuote(req, { LOADSURE_API_KEY: "k" });
    expect(quote.kind).toBe("indicative");
    expect(quote.insuredAmountUsd).toBe(40000);
    expect(quote.ratePer100Usd).toBe(0.6);
    expect(quote.premiumUsd).toBe(240);
    expect(quote.notes).toContain("loadsure");
  });
});

describe("events", () => {
  it("alerts on high score or a coverage gap only", () => {
    expect(isAlertWorthy(EVENT)).toBe(true);
    expect(isAlertWorthy({ ...EVENT, summary: { ...EVENT.summary, score: 4, coverageGapUsd: -5000 } })).toBe(false);
    expect(eventHeadline(EVENT)).toContain("$90,000 uncovered");
  });

  it("builds sinks from env and isolates failures", async () => {
    expect(getEventSinks({})).toEqual([]);
    const { impl, calls } = fakeFetch((url) => (url.includes("slack") ? { status: 500, body: "down" } : { body: {} }));
    const results = await publishRiskEvent(
      EVENT,
      { SLACK_WEBHOOK_URL: "https://hooks.slack.test/x", OUTBOUND_WEBHOOK_URL: "https://hooks.zap.test/y", OUTBOUND_WEBHOOK_SECRET: "s" },
      impl
    );
    expect(results).toEqual([
      { sink: "slack", ok: false, error: expect.stringContaining("HTTP 500") },
      { sink: "outbound-webhook", ok: true, error: undefined },
    ]);
    const outbound = calls.find((c) => c.url.includes("zap"))!;
    const body = outbound.init!.body as string;
    expect((outbound.init!.headers as Record<string, string>)["X-Signature-SHA256"]).toBe(signPayload("s", body));
  });

  it("chat sinks stay quiet for low-risk events", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: {} }));
    await new ChatWebhookSink("slack", "https://hooks.slack.test/x", impl).send({
      ...EVENT,
      summary: { ...EVENT.summary, score: 3, coverageGapUsd: 0 },
    });
    expect(calls).toHaveLength(0);
  });

  it("HubSpot writes a note only when the company matches", async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith("/companies/search") ? { body: { results: [{ id: "77" }] } } : { body: { id: "n1" } }
    );
    await new HubSpotSink("tok", impl).send(EVENT);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.hubapi.com/crm/v3/objects/companies/search",
      "https://api.hubapi.com/crm/v3/objects/notes",
    ]);
    const note = JSON.parse(calls[1]!.init!.body as string);
    expect(note.associations[0].to.id).toBe("77");

    const none = fakeFetch(() => ({ body: { results: [] } }));
    await new HubSpotSink("tok", none.impl).send(EVENT);
    expect(none.calls).toHaveLength(1);
  });

  it("outbound sink sends unsigned when no secret is set", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: {} }));
    await new OutboundWebhookSink("https://x.test", undefined, impl).send(EVENT);
    expect((calls[0]!.init!.headers as Record<string, string>)["X-Signature-SHA256"]).toBeUndefined();
  });
});

describe("inbound loads", () => {
  it("accepts a valid envelope and defaults the rest", () => {
    const parsed = parseInboundLoad({ source: "mcleod", intake: { cargo_hazard: { cargoDescription: "Drums" } } });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.source).toBe("mcleod");
      expect(parsed.score).toBe(false);
      expect(parsed.intake.cargo_hazard.cargoDescription).toBe("Drums");
    }
  });

  it("rejects intake that breaks the contract, naming the field", () => {
    const parsed = parseInboundLoad({ intake: { cargo_hazard: { unNumber: "bad" } } });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues?.[0]?.path).toBe("cargo_hazard.unNumber");
  });

  it("checks bearer tokens exactly", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("Bearer s3cre", "s3cret")).toBe(false);
    expect(bearerMatches(null, "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
  });
});

describe("shipping rates", () => {
  it("uses sample rates without a key, sorted cheapest first", async () => {
    const provider = getShippingRateProvider({});
    expect(provider).toBeInstanceOf(SampleRateProvider);
    const { rates } = await provider.rates({ fromZip: "30214", toZip: "90001", weightOz: 64 });
    expect(rates.map((r) => r.rateUsd)).toEqual([...rates.map((r) => r.rateUsd)].sort((a, b) => a - b));
  });
});
