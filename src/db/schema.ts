import { pgTable, pgEnum, text, uuid, timestamp } from "drizzle-orm/pg-core";

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
  // Typed intake payload arrives with the shared factor schemas
  // (src/schemas) in the next milestone; this column is reserved for it.
  intakeData: text("intake_data"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
