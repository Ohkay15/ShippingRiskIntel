/**
 * Lifecycle states shared by UI and actions without importing Drizzle.
 * The pgEnum in src/db/schema must stay identical to this list.
 */
export const SHIPMENT_STATUSES = [
  "draft",
  "extracting",
  "needs_review",
  "scored",
  "actioned",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
