import { FACTOR_GROUP_META, type FormFieldDef } from "@/intake/form-fields";
import { extractionResultSchema, type ExtractionResult } from "./extraction-schema";
import type { ModelClient } from "./model-client";
import type { ExtractShipmentInput, LlmClient } from "./types";

/**
 * Live extraction over any ModelClient. The prompt is generated from the
 * same field metadata that renders the intake form, and the reply is held
 * to the extraction schema — a model cannot add a field, and a malformed
 * reply is an error (the caller keeps the record in draft), never a guess.
 */

function describeField(field: FormFieldDef): string {
  const leaf = field.path.split(".")[1];
  const kind =
    field.kind === "enum"
      ? `one of: ${field.options.join(", ")}`
      : field.kind === "multi"
        ? `array, items from: ${field.options.join(", ")}`
        : field.kind;
  return `    - ${leaf} (${field.label}): ${kind}${field.hint ? ` — ${field.hint}` : ""}`;
}

export function extractionSystemPrompt(): string {
  const groups = FACTOR_GROUP_META.map(
    (g) => `  ${g.key} — ${g.title}:\n${g.fields.map(describeField).join("\n")}`
  ).join("\n");
  return [
    "You extract shipment risk fields from logistics documents (invoices, bills of lading, DG declarations, carrier records).",
    "Return ONLY a JSON object, no prose, shaped as {group: {field: {value, confidence, evidence}}} covering every field below.",
    "Rules:",
    "- value: the field's value in the stated type, or null when the document does not state it. Never guess.",
    "- confidence: 0 to 1. Use 0.9+ only for an explicit, labeled statement; 0 when value is null.",
    "- evidence: a short verbatim quote from the document, or why the field is empty.",
    "- Money in USD as plain numbers. Dates as YYYY-MM-DD.",
    "Fields:",
    groups,
  ].join("\n");
}

/** Pull the first JSON object out of a reply (tolerates code fences). */
export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Model reply contained no JSON object.");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Fill every field the model left out as "not present" (value null,
 * confidence 0) — the same reading the gate gives an omitted field — so a
 * partial reply is gated field by field instead of failing wholesale.
 * Fields the model DID return still face the schema unchanged.
 */
export function completeExtraction(raw: unknown): unknown {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const group of FACTOR_GROUP_META) {
    const given = source[group.key];
    const groupIn = given && typeof given === "object" ? (given as Record<string, unknown>) : {};
    const groupOut: Record<string, unknown> = { ...groupIn };
    for (const field of group.fields) {
      const leaf = field.path.split(".")[1]!;
      if (groupOut[leaf] == null) {
        groupOut[leaf] = { value: null, confidence: 0, evidence: "Field not present in provider response" };
      }
    }
    out[group.key] = groupOut;
  }
  return out;
}

export class ModelExtractionClient implements LlmClient {
  readonly name: string;
  constructor(private readonly model: ModelClient) {
    this.name = `${model.provider}:${model.model}`;
  }

  async extractShipment(input: ExtractShipmentInput): Promise<ExtractionResult> {
    const turn = await this.model.complete({
      system: extractionSystemPrompt(),
      transcript: [
        {
          type: "user",
          text: `Document type: ${input.kind}\n\n<document>\n${input.text}\n</document>`,
        },
      ],
      maxTokens: 4096,
    });
    const parsed = extractionResultSchema.safeParse(completeExtraction(parseJsonObject(turn.text)));
    if (!parsed.success) {
      throw new Error(
        `${this.name} returned extraction output that failed the schema: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      );
    }
    return parsed.data as ExtractionResult;
  }
}
