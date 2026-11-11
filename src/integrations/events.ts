import { createHmac } from "node:crypto";

import { requestJson, type FetchLike } from "./http";
import { envValue, hasEnv } from "./status";
import type { EnvSource } from "./types";

/**
 * Outbound events: one normalized "risk event" fans out to every connected
 * sink — CRM (HubSpot), team messaging (Slack, Teams) and the generic signed
 * webhook (Zapier, Make, n8n). Sinks are independent: one failing never
 * blocks another, and nothing here can fail the scoring write that
 * triggered it.
 */

export type RiskEventType = "shipment.scored" | "shipment.actioned";

export interface RiskEvent {
  type: RiskEventType;
  shipmentId: string;
  shipmentUrl: string | null;
  occurredAt: string;
  summary: {
    cargoDescription: string | null;
    lane: string | null;
    /** Shipper / account name used to match a CRM company, when known. */
    accountName: string | null;
    score: number;
    cell: string;
    coverageGapUsd: number | null;
    declaredValueUsd: number | null;
    needsReview: boolean;
  };
}

export interface EventSink {
  readonly id: string;
  send(event: RiskEvent): Promise<void>;
}

/** Alert threshold for chat sinks: high score or any uncovered dollars. */
export function isAlertWorthy(event: RiskEvent): boolean {
  return event.summary.score >= 12 || (event.summary.coverageGapUsd ?? 0) > 0;
}

function usd(n: number | null): string {
  if (n == null) return "unknown";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function eventHeadline(event: RiskEvent): string {
  const s = event.summary;
  const what = s.cargoDescription ?? "Shipment";
  const gap = s.coverageGapUsd != null && s.coverageGapUsd > 0 ? ` · ${usd(s.coverageGapUsd)} uncovered` : "";
  const verb = event.type === "shipment.actioned" ? "actioned" : "scored";
  return `${what} ${verb}: score ${s.score.toFixed(1)} (${s.cell})${gap}${s.lane ? ` · lane ${s.lane}` : ""}`;
}

// ---- Slack / Teams ----------------------------------------------------------

export class ChatWebhookSink implements EventSink {
  constructor(
    readonly id: "slack" | "teams",
    private readonly url: string,
    private readonly fetchImpl?: FetchLike
  ) {}
  async send(event: RiskEvent): Promise<void> {
    if (!isAlertWorthy(event)) return;
    const link = event.shipmentUrl ? `\n${event.shipmentUrl}` : "";
    await requestJson({
      connectorId: this.id,
      url: this.url,
      body: { text: `${eventHeadline(event)}${link}` },
      fetchImpl: this.fetchImpl,
    });
  }
}

// ---- Generic signed webhook ---------------------------------------------------

export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export class OutboundWebhookSink implements EventSink {
  readonly id = "outbound-webhook";
  constructor(
    private readonly url: string,
    private readonly secret: string | undefined,
    private readonly fetchImpl?: FetchLike
  ) {}
  async send(event: RiskEvent): Promise<void> {
    const body = JSON.stringify(event);
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-Event-Type": event.type };
    if (this.secret) headers["X-Signature-SHA256"] = signPayload(this.secret, body);
    await requestJson({ connectorId: this.id, url: this.url, rawBody: body, headers, fetchImpl: this.fetchImpl });
  }
}

// ---- HubSpot ------------------------------------------------------------------

interface HubSpotSearchResponse {
  results?: { id: string }[];
}

/**
 * Writes the risk summary as a Note on the HubSpot company whose name
 * matches the shipment's account. No match → no write (never creates
 * companies on its own).
 */
export class HubSpotSink implements EventSink {
  readonly id = "hubspot";
  constructor(
    private readonly token: string,
    private readonly fetchImpl?: FetchLike
  ) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}` };
  }

  async send(event: RiskEvent): Promise<void> {
    const name = event.summary.accountName;
    if (!name) return;
    const search = await requestJson<HubSpotSearchResponse>({
      connectorId: this.id,
      url: "https://api.hubapi.com/crm/v3/objects/companies/search",
      headers: this.headers(),
      body: {
        filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: name }] }],
        properties: ["name"],
        limit: 1,
      },
      fetchImpl: this.fetchImpl,
    });
    const companyId = search.results?.[0]?.id;
    if (!companyId) return;
    const s = event.summary;
    const lines = [
      eventHeadline(event),
      `Declared value: ${usd(s.declaredValueUsd)} · Coverage gap: ${usd(s.coverageGapUsd)}`,
      s.needsReview ? "Some factors still need human review." : "All factors rated.",
      event.shipmentUrl ?? "",
    ].filter(Boolean);
    await requestJson({
      connectorId: this.id,
      url: "https://api.hubapi.com/crm/v3/objects/notes",
      headers: this.headers(),
      body: {
        properties: { hs_timestamp: event.occurredAt, hs_note_body: lines.join("<br>") },
        associations: [
          {
            to: { id: companyId },
            // HubSpot-defined association: note → company.
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 190 }],
          },
        ],
      },
      fetchImpl: this.fetchImpl,
    });
  }
}

// ---- Registry -----------------------------------------------------------------

export function getEventSinks(env: EnvSource, fetchImpl?: FetchLike): EventSink[] {
  const sinks: EventSink[] = [];
  if (hasEnv(env, ["HUBSPOT_ACCESS_TOKEN"])) sinks.push(new HubSpotSink(envValue(env, "HUBSPOT_ACCESS_TOKEN")!, fetchImpl));
  if (hasEnv(env, ["SLACK_WEBHOOK_URL"])) sinks.push(new ChatWebhookSink("slack", envValue(env, "SLACK_WEBHOOK_URL")!, fetchImpl));
  if (hasEnv(env, ["TEAMS_WEBHOOK_URL"])) sinks.push(new ChatWebhookSink("teams", envValue(env, "TEAMS_WEBHOOK_URL")!, fetchImpl));
  if (hasEnv(env, ["OUTBOUND_WEBHOOK_URL"])) {
    sinks.push(new OutboundWebhookSink(envValue(env, "OUTBOUND_WEBHOOK_URL")!, envValue(env, "OUTBOUND_WEBHOOK_SECRET"), fetchImpl));
  }
  return sinks;
}

export interface PublishResult {
  sink: string;
  ok: boolean;
  error?: string;
}

/** Fan out to every sink; never throws. */
export async function publishRiskEvent(event: RiskEvent, env: EnvSource, fetchImpl?: FetchLike): Promise<PublishResult[]> {
  const sinks = getEventSinks(env, fetchImpl);
  const settled = await Promise.allSettled(sinks.map((s) => s.send(event)));
  return settled.map((r, i) => ({
    sink: sinks[i]!.id,
    ok: r.status === "fulfilled",
    error: r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : undefined,
  }));
}
