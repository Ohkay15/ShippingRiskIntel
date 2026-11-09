import { z } from "zod";

import {
  delaySensitivitySchema,
  escalationExposureSchema,
  fragilityClassSchema,
  hazardClassSchema,
  liveConditionsSchema,
  loadTypeSchema,
  shipmentIntakeSchema,
  transportModeSchema,
  FACTOR_KEYS,
  type ShipmentIntake,
} from "@/schemas/shipment";
import {
  extractionFieldEntries,
  type ExtractionResult,
} from "@/llm/extraction-schema";

/**
 * The confidence gate (spec, locked): a field below 0.75 confidence is
 * nulled and the record routes to Needs review. The gate is pure — same
 * extraction, same gated intake, every time — and its output values are
 * re-validated by the shared intake schema, so nothing the provider says
 * about an enum is trusted without passing the same contract the form uses.
 */

export const CONFIDENCE_THRESHOLD = 0.75;

export type FlagReason = "low_confidence" | "missing" | "invalid_value";

export interface FlaggedField {
  /** Dotted wire path, e.g. "cargo_hazard.unNumber". */
  path: string;
  reason: FlagReason;
  confidence: number;
  /** Verbatim provider evidence, or why the field is empty. */
  evidence: string;
}

export interface GatedExtraction {
  /** Validated intake values — fields below the gate are simply absent. */
  intake: ShipmentIntake;
  /** Every field that did not pass the gate, with its evidence. */
  flaggedFields: FlaggedField[];
  needsReview: boolean;
}

/** Final value schemas per wire path — the intake schema's leaf contracts. */
const FIELD_VALUE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "cargo_hazard.hazardClass": hazardClassSchema,
  "route_lane.mode": transportModeSchema,
  "load_type.loadType": loadTypeSchema,
  "value_fragility.fragilityClass": fragilityClassSchema,
  "sensitivity.delaySensitivity": delaySensitivitySchema,
  "escalation.escalationExposure": escalationExposureSchema,
  "live_conditions.conditions": z.array(liveConditionsSchema),
};

function setAt(payload: Record<string, unknown>, path: string, value: unknown) {
  const [group, leaf] = path.split(".");
  if (!group || !leaf) throw new Error(`Malformed field path: ${path}`);
  const groupPayload = (payload[group] ?? {}) as Record<string, unknown>;
  groupPayload[leaf] = value;
  payload[group] = groupPayload;
}

/** Apply the confidence gate to one provider extraction result. */
export function applyConfidenceGate(result: ExtractionResult): GatedExtraction {
  const payload: Record<string, unknown> = {};
  const flaggedFields: FlaggedField[] = [];

  for (const { path, field } of extractionFieldEntries(result)) {
    if (field.value == null) {
      flaggedFields.push({
        path,
        reason: "missing",
        confidence: field.confidence,
        evidence: field.evidence,
      });
      continue;
    }

    if (field.confidence < CONFIDENCE_THRESHOLD) {
      flaggedFields.push({
        path,
        reason: "low_confidence",
        confidence: field.confidence,
        evidence: field.evidence,
      });
      continue;
    }

    const valueSchema = FIELD_VALUE_SCHEMAS[path];
    if (valueSchema && !valueSchema.safeParse(field.value).success) {
      // A value the intake contract rejects can never enter the record —
      // flagged, not coerced and not guessed around.
      flaggedFields.push({
        path,
        reason: "invalid_value",
        confidence: field.confidence,
        evidence: field.evidence,
      });
      continue;
    }

    setAt(payload, path, field.value);
  }

  const intake = shipmentIntakeSchema.parse(payload);
  return { intake, flaggedFields, needsReview: flaggedFields.length > 0 };
}

/**
 * Overlay extracted intake onto the record's existing values: an extracted
 * field fills an unknown slot and never clobbers a value the operator (or
 * a previous extraction) already set — editing the form is how a value
 * changes, not re-running extraction. Unknown means null or an empty list.
 */
export function mergeIntake(
  existing: ShipmentIntake,
  extracted: ShipmentIntake
): ShipmentIntake {
  const out = shipmentIntakeSchema.parse({});
  for (const key of FACTOR_KEYS) {
    const incoming = extracted[key] as Record<string, unknown>;
    const current = existing[key] as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...current };
    for (const leaf of Object.keys(incoming)) {
      const value = incoming[leaf];
      const present =
        value != null && !(Array.isArray(value) && value.length === 0);
      const currentLeaf = current[leaf];
      const currentAbsent =
        currentLeaf == null ||
        (Array.isArray(currentLeaf) && currentLeaf.length === 0);
      if (present && currentAbsent) merged[leaf] = value;
    }
    out[key] = merged as never;
  }
  return out;
}

/**
 * Merge extractions from several documents field-by-field: the
 * highest-confidence non-null value wins, with its evidence. Absent fields
 * pass through as null so the gate flags them as missing.
 */
export function mergeExtractions(results: ExtractionResult[]): ExtractionResult | null {
  if (results.length === 0) return null;

  const merged: Record<string, Record<string, unknown>> = {};
  for (const result of results) {
    for (const { path, field } of extractionFieldEntries(result)) {
      const [group, leaf] = path.split(".");
      if (!group || !leaf) continue;
      merged[group] ??= {};
      const current = merged[group][leaf] as
        | { value: unknown; confidence: number; evidence: string }
        | undefined;
      if (!current || (field.value != null && field.confidence > current.confidence)) {
        merged[group][leaf] = field;
      }
    }
  }
  return merged as unknown as ExtractionResult;
}
