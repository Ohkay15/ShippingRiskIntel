import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import type { ShipmentStatus } from "@/db/lifecycle";
import { PLACEHOLDER_CARRIER_FIT_MATRIX } from "@/carriers/matrix-data";
import { recommendCarriers } from "@/carriers/recommend";
import { PLACEHOLDER_INSURER_FIT_MATRIX } from "@/insurance/matrix-data";
import { recommendCoverageLimit } from "@/insurance/limit";
import { recommendInsurance } from "@/insurance/recommend";
import { networkNews, routeConditions } from "@/conditions/service";
import { getCarrierDataProvider } from "@/integrations/carrier-data";
import { getInsuranceQuote } from "@/integrations/insurance-quotes";
import { integrationStatusReport, processEnv, STATUS_LABELS } from "@/integrations/status";
import type { ToolSpec } from "@/llm/model-client";
import { factorRows, recordSummary } from "@/profile/view-model";
import { shipmentIntakeSchema, type FactorKey, type ShipmentIntake } from "@/schemas/shipment";
import type { RiskProfile } from "@/scoring/engine";
import { demoShipmentUuid } from "@/scoring/demo-seed";
import { displayShipmentId } from "@/dashboard/record-id";

export { displayShipmentId };

/**
 * The assistant's tools — the ONLY way the assistant (in-app chat, MCP
 * clients, Slack) touches data. Every number in an answer comes from one of
 * these calls into the real engine; tools never let a model invent a score,
 * a premium or a gap. All tools here are read-only: anything that changes a
 * record stays a human click in the UI.
 */

export interface AgentTool extends ToolSpec {
  run(input: Record<string, unknown>): Promise<unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts a record UUID or a demo id like "SH-007" / "sh 7". */
export function resolveShipmentId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (UUID.test(value)) return value.toLowerCase();
  const demo = value.match(/^sh[-\s]?0*(\d{1,3})$/i);
  if (demo) {
    try {
      return demoShipmentUuid(`SH-${demo[1]!.padStart(3, "0")}`);
    } catch {
      return null;
    }
  }
  return null;
}

function round(n: number | null | undefined, digits = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

interface LoadedShipment {
  id: string;
  status: ShipmentStatus;
  intake: ShipmentIntake;
  profile: RiskProfile | null;
  confirmedFactors: FactorKey[];
}

async function loadShipment(rawId: unknown): Promise<LoadedShipment> {
  const id = resolveShipmentId(rawId);
  if (!id) throw new Error(`"${String(rawId)}" is not a shipment id. Use a record id or a demo id like SH-007.`);
  const [row] = await db
    .select({
      id: shipments.id,
      status: shipments.status,
      intakeData: shipments.intakeData,
      profile: shipments.profile,
      confirmedFactors: shipments.confirmedFactors,
    })
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);
  if (!row) throw new Error(`Shipment ${displayShipmentId(id)} was not found.`);
  const intake = shipmentIntakeSchema.parse(row.intakeData);
  return {
    id: row.id,
    status: row.status,
    intake,
    profile: row.profile ?? null,
    confirmedFactors: row.confirmedFactors as FactorKey[],
  };
}

function shipmentHeadline(s: { id: string; status: ShipmentStatus; intake: ShipmentIntake; profile: RiskProfile | null }) {
  return {
    id: displayShipmentId(s.id),
    recordId: s.id,
    summary: recordSummary(s.intake),
    status: s.status,
    score: round(s.profile?.score),
    cell: s.profile?.cell ?? null,
    coverageGapUsd: s.profile?.coverageGapUsd ?? null,
    declaredValueUsd: s.intake.value_fragility.declaredValueUsd ?? null,
    link: `/shipments/${s.id}`,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const listShipments: AgentTool = {
  name: "list_shipments",
  description:
    "List shipment records with score (1–25, higher is riskier), risk-matrix cell (LL/LH/HL/HH), status and coverage gap in USD. Filter and sort to answer portfolio questions.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["draft", "extracting", "needs_review", "scored", "actioned"] },
      coverage_gap_only: { type: "boolean", description: "Only records with uncovered dollars (gap > 0)." },
      min_score: { type: "number" },
      cell: { type: "string", enum: ["LL", "LH", "HL", "HH"] },
      sort: { type: "string", enum: ["score", "gap", "updated"], description: "Default: score, descending." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 10." },
    },
  },
  async run(input) {
    const rows = await db
      .select({
        id: shipments.id,
        status: shipments.status,
        intakeData: shipments.intakeData,
        profile: shipments.profile,
        updatedAt: shipments.updatedAt,
      })
      .from(shipments)
      .orderBy(desc(shipments.updatedAt))
      .limit(500);
    let items = rows.map((r) => ({
      ...shipmentHeadline({
        id: r.id,
        status: r.status,
        intake: shipmentIntakeSchema.parse(r.intakeData),
        profile: r.profile ?? null,
      }),
      updatedAt: r.updatedAt.toISOString(),
    }));
    if (typeof input.status === "string") items = items.filter((i) => i.status === input.status);
    if (input.coverage_gap_only === true) items = items.filter((i) => (i.coverageGapUsd ?? 0) > 0);
    if (typeof input.min_score === "number") items = items.filter((i) => (i.score ?? 0) >= (input.min_score as number));
    if (typeof input.cell === "string") items = items.filter((i) => i.cell === input.cell);
    const sort = typeof input.sort === "string" ? input.sort : "score";
    items.sort((a, b) =>
      sort === "gap"
        ? (b.coverageGapUsd ?? -Infinity) - (a.coverageGapUsd ?? -Infinity)
        : sort === "updated"
          ? b.updatedAt.localeCompare(a.updatedAt)
          : (b.score ?? -1) - (a.score ?? -1)
    );
    const limit = typeof input.limit === "number" ? Math.min(50, Math.max(1, Math.floor(input.limit))) : 10;
    return { total: items.length, shipments: items.slice(0, limit) };
  },
};

const portfolioSummary: AgentTool = {
  name: "portfolio_summary",
  description: "Totals across all records: counts by status and matrix cell, total uncovered dollars, and the riskiest records.",
  inputSchema: { type: "object", properties: {} },
  async run() {
    const rows = await db
      .select({ id: shipments.id, status: shipments.status, intakeData: shipments.intakeData, profile: shipments.profile })
      .from(shipments)
      .limit(1000);
    const byStatus: Record<string, number> = {};
    const byCell: Record<string, number> = {};
    let totalGap = 0;
    let gapCount = 0;
    let unknownCoverage = 0;
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.profile) {
        byCell[r.profile.cell] = (byCell[r.profile.cell] ?? 0) + 1;
        if (r.profile.coverageGapUsd == null) unknownCoverage += 1;
        else if (r.profile.coverageGapUsd > 0) {
          totalGap += r.profile.coverageGapUsd;
          gapCount += 1;
        }
      }
    }
    const top = rows
      .filter((r) => r.profile)
      .sort((a, b) => (b.profile!.score ?? 0) - (a.profile!.score ?? 0))
      .slice(0, 5)
      .map((r) => shipmentHeadline({ id: r.id, status: r.status, intake: shipmentIntakeSchema.parse(r.intakeData), profile: r.profile }));
    return {
      records: rows.length,
      byStatus,
      byMatrixCell: byCell,
      uncoveredUsdTotal: round(totalGap),
      recordsWithCoverageGap: gapCount,
      recordsWithUnknownCoverage: unknownCoverage,
      riskiest: top,
    };
  },
};

const getRiskProfile: AgentTool = {
  name: "get_risk_profile",
  description:
    "One shipment's full risk profile: composite score, matrix cell, coverage gap, and every factor's likelihood × consequence × weight with where the rating came from (rule, document evidence, human review, or conservative default).",
  inputSchema: {
    type: "object",
    properties: { shipment_id: { type: "string", description: "Record UUID or demo id like SH-007." } },
    required: ["shipment_id"],
  },
  async run(input) {
    const s = await loadShipment(input.shipment_id);
    if (!s.profile) return { ...shipmentHeadline(s), note: "Not scored yet — confirm the record to score it." };
    return {
      ...shipmentHeadline(s),
      likelihoodIndex: round(s.profile.likelihoodIndex),
      consequenceIndex: round(s.profile.consequenceIndex),
      provisional: s.status === "needs_review",
      reviewFlags: s.profile.reviewFlags,
      factors: factorRows(s.profile).map((f) => ({
        factor: f.label,
        likelihood: f.likelihood,
        consequence: f.consequence,
        weight: f.weight,
        contribution: f.contribution,
        basis: `${f.basis.label}: ${f.basis.detail}`,
      })),
    };
  },
};

const recommendCarriersTool: AgentTool = {
  name: "recommend_carriers",
  description:
    "Top carrier swaps for a scored shipment, each with the projected score after the swap and which factors move. Lower projected score is better.",
  inputSchema: {
    type: "object",
    properties: { shipment_id: { type: "string" } },
    required: ["shipment_id"],
  },
  async run(input) {
    const s = await loadShipment(input.shipment_id);
    if (!s.profile) throw new Error("Shipment is not scored yet.");
    const recs = recommendCarriers(s.intake, s.profile, PLACEHOLDER_CARRIER_FIT_MATRIX, new Set(s.confirmedFactors));
    return {
      shipment: displayShipmentId(s.id),
      currentScore: round(s.profile.score),
      matrixSource: PLACEHOLDER_CARRIER_FIT_MATRIX.sourceLabel,
      recommendations: recs.map((r) => ({
        carrier: r.carrier.name,
        carrierId: r.carrier.id,
        projectedScore: round(r.projectedProfile.score),
        scoreDelta: r.scoreDelta,
        factorChanges: r.factorDeltas.map((d) => d.factor),
      })),
    };
  },
};

const recommendInsuranceTool: AgentTool = {
  name: "recommend_insurance",
  description:
    "Recommended coverage limit and the insurance products that best close a shipment's coverage gap, with the projected gap after each product.",
  inputSchema: {
    type: "object",
    properties: { shipment_id: { type: "string" } },
    required: ["shipment_id"],
  },
  async run(input) {
    const s = await loadShipment(input.shipment_id);
    if (!s.profile) throw new Error("Shipment is not scored yet.");
    const limit = recommendCoverageLimit(s.intake, s.profile);
    const recs = recommendInsurance(s.intake, s.profile, PLACEHOLDER_INSURER_FIT_MATRIX, limit.recommendedLimitUsd);
    return {
      shipment: displayShipmentId(s.id),
      currentGapUsd: s.profile.coverageGapUsd,
      recommendedLimitUsd: limit.recommendedLimitUsd,
      matrixSource: PLACEHOLDER_INSURER_FIT_MATRIX.sourceLabel,
      products: recs.map((r) => ({
        product: `${r.product.insurerName} — ${r.product.productName}`,
        productId: r.product.id,
        providedCoverageUsd: r.providedCoverageUsd,
        projectedGapUsd: r.projectedGapUsd,
        gapDeltaUsd: r.gapDeltaUsd,
        terms: r.product.liabilityTerms,
      })),
    };
  },
};

const quoteInsurance: AgentTool = {
  name: "quote_insurance",
  description:
    "Per-shipment cargo insurance quote for a shipment's coverage gap (default) or its full declared value. Says whether the quote is indicative or live from a connected insurer. Never present an indicative quote as an offer.",
  inputSchema: {
    type: "object",
    properties: {
      shipment_id: { type: "string" },
      insure: { type: "string", enum: ["gap", "full_value"], description: "Default: gap." },
    },
    required: ["shipment_id"],
  },
  async run(input) {
    const s = await loadShipment(input.shipment_id);
    const declared = s.intake.value_fragility.declaredValueUsd;
    if (declared == null) throw new Error("No declared value on file — cannot quote.");
    const gap = s.profile?.coverageGapUsd ?? null;
    const amount = input.insure === "full_value" || gap == null || gap <= 0 ? declared : gap;
    const quote = await getInsuranceQuote(
      {
        shipmentRef: displayShipmentId(s.id),
        declaredValueUsd: declared,
        insuredAmountUsd: amount,
        cargoDescription: s.intake.cargo_hazard.cargoDescription ?? null,
        hazardClass: s.intake.cargo_hazard.hazardClass ?? null,
        fragilityClass: s.intake.value_fragility.fragilityClass ?? null,
        mode: s.intake.route_lane.mode ?? null,
        origin: s.intake.route_lane.origin ?? null,
        destination: s.intake.route_lane.destination ?? null,
      },
      processEnv()
    );
    return { shipment: displayShipmentId(s.id), insuring: amount === declared ? "full_value" : "gap", ...quote };
  },
};

const lookupCarrier: AgentTool = {
  name: "lookup_carrier_safety",
  description:
    "Public safety record for a US motor carrier by DOT number (FMCSA when connected, otherwise clearly labeled sample data), with a suggested 1–5 safety rating on the engine's scale.",
  inputSchema: {
    type: "object",
    properties: { dot_number: { type: "string" } },
    required: ["dot_number"],
  },
  async run(input) {
    return getCarrierDataProvider(processEnv()).lookupByDot(String(input.dot_number ?? ""));
  },
};

const integrationStatus: AgentTool = {
  name: "integration_status",
  description: "Which integrations are connected, which are ready for a key, and which need partner access.",
  inputSchema: { type: "object", properties: {} },
  async run() {
    return integrationStatusReport(processEnv()).map((g) => ({
      category: g.category,
      connectors: g.connectors.map((c) => ({ name: c.def.name, status: STATUS_LABELS[c.status], missingEnv: c.missingEnv })),
    }));
  },
};

const routeConditionsTool: AgentTool = {
  name: "route_conditions",
  description:
    "Live conditions on a shipment's lane: active National Weather Service alerts along the route (most severe first), recent news about the origin/destination and freight topics, and lane distance. Free public data; US weather coverage only. The map with radar is on the shipment page.",
  inputSchema: {
    type: "object",
    properties: { shipment_id: { type: "string", description: "Record UUID or demo id like SH-007." } },
    required: ["shipment_id"],
  },
  async run(input) {
    const s = await loadShipment(input.shipment_id);
    const lane = s.intake.route_lane;
    const c = await routeConditions(lane.origin, lane.destination);
    return {
      shipment: displayShipmentId(s.id),
      link: `/shipments/${s.id}#conditions`,
      origin: c.origin?.name ?? lane.origin ?? null,
      destination: c.destination?.name ?? lane.destination ?? null,
      laneKm: c.route ? Math.round(c.route.distanceKm) : null,
      laneIsApproximate: c.route?.approximate ?? null,
      alerts: c.alerts.slice(0, 8).map((a) => ({
        event: a.event,
        severity: a.severity,
        area: a.area,
        until: a.ends,
        headline: a.headline,
      })),
      news: c.news.slice(0, 6).map((n) => ({ title: n.title, source: n.domain, url: n.url, seenAt: n.seenAt })),
      issues: c.issues,
      sources: c.sources.map((src) => src.label),
    };
  },
};

const freightNewsTool: AgentTool = {
  name: "freight_news",
  description:
    "Recent US freight and supply-chain news (trucking, ports, rail, tariffs, cargo theft) from the GDELT Project. Use for 'what's happening in freight' questions; for one lane use route_conditions.",
  inputSchema: { type: "object", properties: {} },
  async run() {
    const items = await networkNews();
    return items.map((n) => ({ title: n.title, source: n.domain, url: n.url, seenAt: n.seenAt }));
  },
};

export const AGENT_TOOLS: readonly AgentTool[] = [
  portfolioSummary,
  listShipments,
  getRiskProfile,
  recommendCarriersTool,
  recommendInsuranceTool,
  quoteInsurance,
  lookupCarrier,
  integrationStatus,
  routeConditionsTool,
  freightNewsTool,
];

export function toolByName(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

/** Run a tool, returning its result as text for the model (errors included). */
export async function runTool(name: string, input: Record<string, unknown>): Promise<{ ok: boolean; content: string; data: unknown }> {
  const tool = toolByName(name);
  if (!tool) return { ok: false, content: `Unknown tool "${name}".`, data: null };
  try {
    const data = await tool.run(input ?? {});
    return { ok: true, content: JSON.stringify(data), data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: `Error: ${message}`, data: null };
  }
}
