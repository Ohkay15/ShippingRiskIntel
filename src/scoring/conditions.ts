import { z } from "zod";

/**
 * Declarative condition DSL used by scoring rules.
 *
 * Scoring rules live in config as data (spec: "weights and rules in config,
 * not code") so calibration never touches engine logic. Conditions resolve
 * dotted field paths against a record view — the shipment intake record under
 * `record` plus engine-derived values under `derived` — and combine with
 * and/or/not.
 *
 * Unknown fields never satisfy a comparison: a condition on a missing
 * (null/undefined) field evaluates false, except the explicit `exists` op.
 * This is what routes missing data to conservative defaults instead of
 * guesses.
 */

export type ComparisonOp = "gt" | "gte" | "lt" | "lte";

export type Condition =
  | { field: string; op: "eq"; value: string | number | boolean | null }
  | { field: string; op: "neq"; value: string | number | boolean | null }
  | { field: string; op: "in"; values: ReadonlyArray<string | number | boolean> }
  | { field: string; op: ComparisonOp; value: number | string }
  | { field: string; op: "contains"; value: string | number | boolean }
  | { field: string; op: "exists"; value: boolean }
  | { and: ReadonlyArray<Condition> }
  | { or: ReadonlyArray<Condition> }
  | { not: Condition };

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Recursive schema: the explicit annotation breaks inference circularity. */
export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ field: z.string().min(1), op: z.literal("eq"), value: scalarSchema }),
    z.object({ field: z.string().min(1), op: z.literal("neq"), value: scalarSchema }),
    z.object({
      field: z.string().min(1),
      op: z.literal("in"),
      values: z.array(z.union([z.string(), z.number(), z.boolean()])),
    }),
    z.object({
      field: z.string().min(1),
      op: z.enum(["gt", "gte", "lt", "lte"]),
      value: z.union([z.number(), z.string()]),
    }),
    z.object({
      field: z.string().min(1),
      op: z.literal("contains"),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({ field: z.string().min(1), op: z.literal("exists"), value: z.boolean() }),
    z.object({ and: z.array(conditionSchema).min(1) }),
    z.object({ or: z.array(conditionSchema).min(1) }),
    z.object({ not: conditionSchema }),
  ])
);

export interface FieldLookup {
  present: boolean;
  value: unknown;
}

/** Resolve a dotted path ("record.cargo_hazard.hazardClass") through plain objects. */
export function resolveField(source: unknown, path: string): FieldLookup {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) {
      return { present: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { present: current !== undefined && current !== null, value: current };
}

export function evaluateCondition(condition: Condition, view: unknown): boolean {
  if ("and" in condition) {
    return condition.and.every((nested) => evaluateCondition(nested, view));
  }
  if ("or" in condition) {
    return condition.or.some((nested) => evaluateCondition(nested, view));
  }
  if ("not" in condition) {
    return !evaluateCondition(condition.not, view);
  }

  const { present, value } = resolveField(view, condition.field);
  switch (condition.op) {
    case "eq":
      return present && value === condition.value;
    case "neq":
      return present && value !== condition.value;
    case "in":
      return present && (condition.values as readonly unknown[]).includes(value);
    case "contains":
      return present && Array.isArray(value) && (value as unknown[]).includes(condition.value);
    case "exists":
      return condition.value ? present : !present;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return present && compare(value, condition.op, condition.value);
    default: {
      // Exhaustiveness guard — config validation makes this unreachable.
      const exhaustive: never = condition;
      throw new Error(`Unknown condition: ${JSON.stringify(exhaustive)}`);
    }
  }
}

const NUMBER_COMPARISONS: Record<ComparisonOp, (a: number, b: number) => boolean> = {
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};

const STRING_COMPARISONS: Record<ComparisonOp, (a: string, b: string) => boolean> = {
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};

/**
 * Order comparison for numbers and same-format strings (ISO dates order
 * lexicographically). Mixed or missing types never match — an unknown value
 * is not evidence for either side of a comparison.
 */
function compare(left: unknown, op: ComparisonOp, right: number | string): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return NUMBER_COMPARISONS[op](left, right);
  }
  if (typeof left === "string" && typeof right === "string") {
    return STRING_COMPARISONS[op](left, right);
  }
  return false;
}
