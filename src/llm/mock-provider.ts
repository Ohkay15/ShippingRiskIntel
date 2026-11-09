import type { ExtractedField, ExtractionResult } from "./extraction-schema";
import { FACTOR_GROUP_META, type FormFieldDef } from "@/intake/form-fields";
import type { ExtractShipmentInput, LlmClient } from "./types";

/**
 * Deterministic mock extraction: labeled patterns in the document text map
 * to fields. Same input, same output, every time — no network, no API key.
 *
 * Confidence bands (deliberately coarse so the gate boundary is testable):
 *   0.95  exact labeled match, value used verbatim
 *   0.90  match needing normalization (money, enum, list)
 *   0.00  field not present — value null, never guessed
 *
 * A live provider returns the same shape; call sites cannot tell the
 * difference and must not try.
 */

const EXACT_TEXT_PATTERNS: Record<string, RegExp> = {
  cargoDescription: /cargo description:\s*(.+)/i,
  hsCode: /hs(?:\s?code)?:\s*([\d.]{4,})/i,
  packingType: /packing(?:\s?type)?:\s*(.+)/i,
  carrierId: /carrier\s?id:\s*(.+)/i,
  carrierName: /carrier:\s*(.+)/i,
  origin: /origin:\s*(.+)/i,
  destination: /destination:\s*(.+)/i,
  laneId: /lane(?:\s?id)?:\s*(.+)/i,
  notes: /notes:\s*(.+)/i,
  escalationContact: /escalation contact:\s*(.+)/i,
};

const NUMBER_PATTERNS: Record<string, RegExp> = {
  carrierSafetyRating: /safety rating:\s*([1-5])/i,
  carrierClaimsRating: /claims rating:\s*([1-5])/i,
  handlingPoints: /handling points:\s*(\d+)/i,
  declaredValueUsd: /declared value:\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
  insuranceCoverageUsd: /insurance coverage:\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
  carrierLiabilityLimitUsd: /liability limit:\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
};

/** Boolean fields parse yes/no/present/absent phrasing. */
const YES = /\b(yes|present)\b/i;
const NO = /\b(no|absent)\b/i;
const BOOLEAN_PATTERNS: Record<string, RegExp> = {
  ispm15CertPresent: /ispm[-\s]?15[^:\n]*:\s*(yes|no|present|absent)/i,
  dgCertPresent: /dg cert[^:\n]*:\s*(yes|no|present|absent)/i,
};

const ENUM_PATTERNS: Record<string, RegExp> = {
  hazardClass: /hazard class:\s*(\d{1,2}(?:\.\d)?|none)/i,
  certExpiryDate: /expir(?:y|es|ation)(?:\s?date)?:\s*(\d{4}-\d{2}-\d{2})/i,
  mode: /mode:\s*(road|rail|ocean|air|intermodal)/i,
  loadType: /load type:\s*(sealed[-\s]?dedicated|shared)/i,
  fragilityClass: /fragility(?:\s?class)?:\s*(low|medium|high|ultra)/i,
  delaySensitivity: /delay sensitivity:\s*(perishable|jit|flexible)/i,
  escalationExposure: /escalation(?:\s?exposure)?:\s*(contained|spreads)/i,
};

const CONDITIONS_PATTERN = /(?:lane\s?)?conditions:\s*(.+)/i;

function notFound(): ExtractedField {
  return {
    value: null,
    confidence: 0,
    evidence: "Field not present in document",
  };
}

function exactText(match: RegExpExecArray): ExtractedField {
  return { value: match[1].trim(), confidence: 0.95, evidence: match[0].trim() };
}

function normalized(match: RegExpExecArray, value: unknown): ExtractedField {
  return { value, confidence: 0.9, evidence: match[0].trim() };
}

function firstMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  const match = pattern.exec(text);
  return match ? match : null;
}

function extractField(
  text: string,
  leaf: string,
  kind: FormFieldDef["kind"]
): ExtractedField {
  const exact = EXACT_TEXT_PATTERNS[leaf];
  if (exact && kind === "text") {
    const match = firstMatch(text, exact);
    if (match) return exactText(match);
    return notFound();
  }

  const numberPattern = NUMBER_PATTERNS[leaf];
  if (numberPattern && kind === "number") {
    const match = firstMatch(text, numberPattern);
    if (match) {
      // Money arrives as "1,250,000.00" — normalize to a bare number.
      return normalized(match, Number(match[1].replace(/,/g, "")));
    }
    return notFound();
  }

  const booleanPattern = BOOLEAN_PATTERNS[leaf];
  if (booleanPattern && kind === "boolean") {
    const match = firstMatch(text, booleanPattern);
    if (match) {
      if (YES.test(match[1])) return normalized(match, true);
      if (NO.test(match[1])) return normalized(match, false);
    }
    return notFound();
  }

  const enumPattern = ENUM_PATTERNS[leaf];
  if (enumPattern && kind === "enum") {
    const match = firstMatch(text, enumPattern);
    if (match) {
      // "sealed-dedicated" normalizes to the schema's enum value.
      const value = match[1]
        .trim()
        .replace(/sealed[-\s]?dedicated/i, "sealed_dedicated")
        .replace(/\s+/g, "_")
        .toLowerCase();
      if (value) return normalized(match, value);
    }
    return notFound();
  }

  if (kind === "multi") {
    const match = firstMatch(text, CONDITIONS_PATTERN);
    if (match) {
      const values = match[1]
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v.length > 0);
      if (values.length > 0) return normalized(match, values);
    }
    return notFound();
  }

  return notFound();
}

export class MockLlmClient implements LlmClient {
  readonly name = "mock";

  async extractShipment({
    text,
  }: ExtractShipmentInput): Promise<ExtractionResult> {
    // Field metadata is the single source of truth for what gets extracted.
    const result: Record<string, Record<string, ExtractedField>> = {};

    for (const group of FACTOR_GROUP_META) {
      const groupResult: Record<string, ExtractedField> = {};
      for (const field of group.fields) {
        const leaf = field.path.split(".")[1] ?? "";
        groupResult[leaf] = extractField(text, leaf, field.kind);
      }
      result[group.key] = groupResult;
    }

    return result as unknown as ExtractionResult;
  }
}
