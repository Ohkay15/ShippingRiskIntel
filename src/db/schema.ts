import {
  pgTable,
  pgEnum,
  uuid,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { shipmentIntakeSchema, type ShipmentIntake } from "../schemas/shipment";

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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
