import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { shipmentIntakeSchema, type ShipmentIntake } from "@/schemas/shipment";
import { CONNECTORS } from "./catalog";

/**
 * Inbound load contract: what any TMS, script or automation POSTs to
 * /api/integrations/inbound. The `intake` object IS the shared shipment
 * intake contract — so a load from McLeod, a Zap, or a curl command lands
 * exactly like a record typed into the form. Per-TMS mappers (when a
 * partner's payload shape is known) translate into this envelope.
 */
export const inboundLoadSchema = z.object({
  /** Which system sent it — a catalog id ("mcleod", "turvo") or free text. */
  source: z.string().min(1).max(64).default("api"),
  /** The sender's own load/shipment reference, echoed back for matching. */
  externalRef: z.string().max(128).optional(),
  intake: z.unknown(),
  /** Score immediately after creating the draft. */
  score: z.boolean().default(false),
});
export type InboundLoad = z.infer<typeof inboundLoadSchema>;

export type InboundParseResult =
  | { ok: true; source: string; externalRef: string | null; intake: ShipmentIntake; score: boolean }
  | { ok: false; error: string; issues?: { path: string; message: string }[] };

export function parseInboundLoad(body: unknown): InboundParseResult {
  const envelope = inboundLoadSchema.safeParse(body);
  if (!envelope.success) {
    return { ok: false, error: "Body must be { source?, externalRef?, intake, score? }." };
  }
  const intake = shipmentIntakeSchema.safeParse(envelope.data.intake ?? {});
  if (!intake.success) {
    return {
      ok: false,
      error: "intake failed the shipment intake contract.",
      issues: intake.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  return {
    ok: true,
    source: envelope.data.source,
    externalRef: envelope.data.externalRef ?? null,
    intake: intake.data,
    score: envelope.data.score,
  };
}

/** Constant-time bearer check. */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length).trim());
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function isKnownTmsSource(source: string): boolean {
  return CONNECTORS.some((c) => c.category === "tms" && c.id === source);
}
