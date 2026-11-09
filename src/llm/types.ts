import type { DocumentKind } from "@/documents/kinds";
import type { ExtractionResult } from "./extraction-schema";

/** What the LLM needs to judge one document. */
export interface ExtractShipmentInput {
  kind: DocumentKind;
  /** Verbatim document text (already read from the upload). */
  text: string;
}

/**
 * The extraction boundary. Providers implement this interface; nothing above
 * it may know which provider answered. Registering a live provider in
 * src/llm/index.ts is a config change, not a refactor of call sites.
 */
export interface LlmClient {
  /** Stable identifier surfaced in UI and logs. */
  readonly name: string;
  extractShipment(input: ExtractShipmentInput): Promise<ExtractionResult>;
}
