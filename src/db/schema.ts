import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { shipmentIntakeSchema, type ShipmentIntake } from "../schemas/shipment";
import type { RiskProfile } from "../scoring/engine";
import type { FlaggedField } from "../extraction/gate";
import { DOCUMENT_KINDS } from "../documents/kinds";

/**
 * Shipment record lifecycle from the MVP spec:
 * Draft -> Extracting -> Needs review -> Scored -> Actioned
 * (Editing a scored record demotes it back to Draft.)
 */
export const shipmentStatusEnum = pgEnum("shipment_status", [
  "draft",
  "extracting",
  "needs_review",
  "scored",
  "actioned",
]);

export const shipments = pgTable("shipments", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: shipmentStatusEnum("status").notNull().default("draft"),
  // Structured intake payload, validated by shipmentIntakeSchema on write.
  // JSON over the wire, strongly typed in code — parsing happens at the edge
  // (server actions), storage trusts the validated shape.
  intakeData: jsonb("intake_data")
    .$type<ShipmentIntake>()
    .notNull()
    .default(shipmentIntakeSchema.parse({})),
  // Fields that failed the 0.75 confidence gate (or the intake contract),
  // with the provider's evidence. null until extraction has run.
  flaggedFields: jsonb("flagged_fields").$type<FlaggedField[]>(),
  // Latest computed risk profile (spec: the dashboard reads profiles from
  // storage — engine changes never touch UI code). null until first score;
  // shown as provisional while the record sits in needs_review.
  profile: jsonb("profile").$type<RiskProfile>(),
  scoredAt: timestamp("scored_at", { withTimezone: true }),
  // Factors the operator accepted at their conservative default rating in
  // the review queue (spec: "Accept, correct, or fill fields"). Only ever
  // applies while the factor's required data is still missing.
  confirmedFactors: jsonb("confirmed_factors").$type<string[]>().notNull().default([]),
  // Fit-matrix carrier id chosen at the Scored → Actioned transition.
  actionedCarrierId: text("actioned_carrier_id"),
  // Post-action projected position (spec state table): the record re-scored
  // with the chosen carrier's attributes substituted in. Stored at pick
  // time; the record's own intakeData and profile stay untouched.
  projectedProfile: jsonb("projected_profile").$type<RiskProfile>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documentKindEnum = pgEnum("document_kind", DOCUMENT_KINDS);

/**
 * An uploaded source document. `rawText` keeps the extracted document text
 * so extraction can be re-run (better provider, recalibrated prompt) without
 * re-uploading — and so evidence quotes stay verifiable against the source.
 */
export const shipmentDocuments = pgTable("shipment_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  shipmentId: uuid("shipment_id")
    .notNull()
    .references(() => shipments.id, { onDelete: "cascade" }),
  kind: documentKindEnum("kind").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  rawText: text("raw_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
