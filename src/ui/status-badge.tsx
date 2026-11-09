import type { ShipmentStatus } from "@/db/lifecycle";

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft: "Draft",
  extracting: "Extracting",
  needs_review: "Needs review",
  scored: "Scored",
  actioned: "Actioned",
};

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  return <span className={`status-badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}
