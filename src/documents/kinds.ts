/**
 * The four document types the MVP accepts (spec §1 / Reform source list).
 * Single source of truth: the DB enum, upload UI, and LLM client all read
 * this list so a kind cannot exist in one layer and not the others.
 */
import { z } from "zod";

export const DOCUMENT_KINDS = [
  "commercial_invoice",
  "packing_list",
  "bill_of_lading",
  "dg_declaration",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const documentKindSchema = z.enum(DOCUMENT_KINDS);

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  commercial_invoice: "Commercial invoice",
  packing_list: "Packing list",
  bill_of_lading: "Bill of lading",
  dg_declaration: "Dangerous goods declaration",
};
