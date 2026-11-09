import {
  HAZARD_CLASS_VALUES,
  delaySensitivitySchema,
  escalationExposureSchema,
  fragilityClassSchema,
  liveConditionValues,
  loadTypeSchema,
  transportModeSchema,
  type FactorKey,
} from "../schemas/shipment";

/**
 * Declarative field metadata for the intake form. One source of truth for
 * rendering (the form page) and parsing (intakePayloadFromFormData) — a field
 * cannot exist in the UI without an agreed wire name.
 */
export type FormFieldDef =
  | { path: string; label: string; kind: "text"; hint?: string }
  | {
      path: string;
      label: string;
      kind: "number";
      min?: number;
      max?: number;
      step?: string;
      hint?: string;
    }
  /** Tri-state (unknown / yes / no) so "absent" never masquerades as "no". */
  | { path: string; label: string; kind: "boolean"; hint?: string }
  | {
      path: string;
      label: string;
      kind: "enum";
      options: readonly string[];
      hint?: string;
    }
  | {
      path: string;
      label: string;
      kind: "multi";
      options: readonly string[];
      hint?: string;
    };

export interface FactorGroupMeta {
  key: FactorKey;
  title: string;
  /** Where these values come from (spec §1 input-field table). */
  source: string;
  fields: FormFieldDef[];
}

export const FACTOR_GROUP_META: readonly FactorGroupMeta[] = [
  {
    key: "cargo_hazard",
    title: "Cargo & hazard",
    source: "Form / invoice, DG declaration",
    fields: [
      {
        path: "cargo_hazard.cargoDescription",
        label: "Cargo description",
        kind: "text",
      },
      { path: "cargo_hazard.hsCode", label: "HS code", kind: "text" },
      {
        path: "cargo_hazard.unNumber",
        label: "UN number",
        kind: "text",
        hint: "Format: UN1830",
      },
      {
        path: "cargo_hazard.hazardClass",
        label: "Hazard class",
        kind: "enum",
        options: HAZARD_CLASS_VALUES,
      },
    ],
  },
  {
    key: "packing_certs",
    title: "Packing & certifications",
    source: "Form / packing list, DG declaration",
    fields: [
      { path: "packing_certs.packingType", label: "Packing type", kind: "text" },
      {
        path: "packing_certs.ispm15CertPresent",
        label: "ISPM-15 cert present",
        kind: "boolean",
      },
      {
        path: "packing_certs.dgCertPresent",
        label: "DG cert present",
        kind: "boolean",
      },
      {
        path: "packing_certs.certExpiryDate",
        label: "Cert expiry date",
        kind: "text",
        hint: "yyyy-mm-dd",
      },
    ],
  },
  {
    key: "carrier_record",
    title: "Carrier & shipper record",
    source: "Form (carrier lookup table)",
    fields: [
      { path: "carrier_record.carrierId", label: "Carrier ID", kind: "text" },
      { path: "carrier_record.carrierName", label: "Carrier name", kind: "text" },
      {
        path: "carrier_record.carrierSafetyRating",
        label: "Carrier safety rating",
        kind: "number",
        min: 1,
        max: 5,
        hint: "1 (best) – 5 (worst)",
      },
      {
        path: "carrier_record.carrierClaimsRating",
        label: "Carrier claims rating",
        kind: "number",
        min: 1,
        max: 5,
        hint: "1 (best) – 5 (worst)",
      },
    ],
  },
  {
    key: "route_lane",
    title: "Route & lane",
    source: "Form / bill of lading",
    fields: [
      { path: "route_lane.origin", label: "Origin", kind: "text" },
      { path: "route_lane.destination", label: "Destination", kind: "text" },
      {
        path: "route_lane.mode",
        label: "Mode",
        kind: "enum",
        options: transportModeSchema.options,
      },
      { path: "route_lane.laneId", label: "Lane ID", kind: "text" },
    ],
  },
  {
    key: "live_conditions",
    title: "Live conditions",
    source: "Form (manual pick in MVP)",
    fields: [
      {
        path: "live_conditions.conditions",
        label: "Active lane conditions",
        kind: "multi",
        options: liveConditionValues,
      },
      { path: "live_conditions.notes", label: "Notes", kind: "text" },
    ],
  },
  {
    key: "load_type",
    title: "Load type",
    source: "Form / bill of lading",
    fields: [
      {
        path: "load_type.loadType",
        label: "Load type",
        kind: "enum",
        options: loadTypeSchema.options,
        hint: "Sealed-dedicated vs shared with handling points",
      },
      {
        path: "load_type.handlingPoints",
        label: "Handling points",
        kind: "number",
        min: 0,
      },
    ],
  },
  {
    key: "value_fragility",
    title: "Value & fragility",
    source: "Form / invoice",
    fields: [
      {
        path: "value_fragility.declaredValueUsd",
        label: "Declared value (USD)",
        kind: "number",
        min: 0,
        step: "0.01",
      },
      {
        path: "value_fragility.fragilityClass",
        label: "Fragility class",
        kind: "enum",
        options: fragilityClassSchema.options,
      },
    ],
  },
  {
    key: "sensitivity",
    title: "Sensitivity",
    source: "Form",
    fields: [
      {
        path: "sensitivity.delaySensitivity",
        label: "Delay sensitivity",
        kind: "enum",
        options: delaySensitivitySchema.options,
      },
    ],
  },
  {
    key: "escalation",
    title: "Escalation potential",
    source: "Form / derived from hazard class",
    fields: [
      {
        path: "escalation.escalationExposure",
        label: "Escalation exposure",
        kind: "enum",
        options: escalationExposureSchema.options,
        hint: "Contained loss vs one that spreads",
      },
      {
        path: "escalation.escalationContact",
        label: "Escalation contact",
        kind: "text",
        hint: "Who to alert when an exception fires",
      },
    ],
  },
  {
    key: "coverage",
    title: "Coverage vs. value",
    source: "Form / invoice terms",
    fields: [
      {
        path: "coverage.insuranceCoverageUsd",
        label: "Insurance coverage (USD)",
        kind: "number",
        min: 0,
        step: "0.01",
      },
      {
        path: "coverage.carrierLiabilityLimitUsd",
        label: "Carrier liability limit (USD)",
        kind: "number",
        min: 0,
        step: "0.01",
      },
    ],
  },
] as const;

/** Human label for a dotted wire path; falls back to the path itself. */
export function fieldLabel(path: string): string {
  for (const group of FACTOR_GROUP_META) {
    for (const field of group.fields) {
      if (field.path === path) return field.label;
    }
  }
  return path;
}
