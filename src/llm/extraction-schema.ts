import { z } from "zod";

import { FACTOR_GROUP_META, type FormFieldDef } from "@/intake/form-fields";

/**
 * Structured extraction output, built from the same field metadata that
 * renders the intake form — the LLM cannot invent a field the form doesn't
 * have. Every leaf wraps its value with the two things the confidence gate
 * needs: per-field confidence and verbatim evidence.
 *
 * The composite score never depends on this prose — only on gated values.
 */

const VALUE_SCHEMAS = {
  text: z.string().min(1),
  number: z.number().finite(),
  boolean: z.boolean(),
  enum: z.string().min(1),
  multi: z.array(z.string()),
} as const satisfies Record<FormFieldDef["kind"], z.ZodTypeAny>;

/** One extracted field: value (null = not found), confidence, evidence. */
export const extractedFieldSchema = z.object({
  value: z.unknown().nullable(),
  confidence: z.number().min(0).max(1),
  /** Verbatim quote from the document, or why the field is empty. */
  evidence: z.string().min(1),
});

export type ExtractedField = {
  value: unknown;
  confidence: number;
  evidence: string;
};

function groupExtractionSchema(fields: readonly FormFieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    const leaf = field.path.split(".")[1];
    if (!leaf) throw new Error(`Malformed form field path: ${field.path}`);
    shape[leaf] = extractedFieldSchema.extend({
      value: VALUE_SCHEMAS[field.kind].nullable(),
    });
  }
  return z.object(shape);
}

/** Mirrors shipmentIntakeSchema field-for-field, with extraction metadata. */
export const extractionResultSchema = z.object(
  Object.fromEntries(
    FACTOR_GROUP_META.map((group) => [
      group.key,
      groupExtractionSchema(group.fields),
    ])
  )
);

export type ExtractionResult = {
  [K in keyof typeof extractionResultSchema.shape]: z.infer<
    (typeof extractionResultSchema.shape)[K]
  >;
};

/** All (field path, confidence) pairs in a stable, form-ordered walk. */
export function extractionFieldEntries(
  result: ExtractionResult
): { path: string; field: ExtractedField }[] {
  const entries: { path: string; field: ExtractedField }[] = [];
  for (const group of FACTOR_GROUP_META) {
    const groupResult = (result[group.key] ?? {}) as Record<
      string,
      ExtractedField | undefined
    >;
    for (const field of group.fields) {
      const leaf = field.path.split(".")[1] ?? "";
      // A provider response that omits a field is reported as absent —
      // never skipped, so the gate flags it as missing rather than
      // letting it silently vanish.
      entries.push({
        path: field.path,
        field:
          groupResult[leaf] ?? {
            value: null,
            confidence: 0,
            evidence: "Field not present in provider response",
          },
      });
    }
  }
  return entries;
}
