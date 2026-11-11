import { describe, expect, it } from "vitest";

import { getLlmClient } from "./index";
import { MockLlmClient } from "./mock-provider";
import { ModelExtractionClient, parseJsonObject } from "./live-extraction";
import {
  AnthropicModelClient,
  getModelClient,
  OpenAiModelClient,
  resolveProviderName,
  toAnthropicMessages,
  toOpenAiInput,
  type ModelClient,
  type TranscriptItem,
} from "./model-client";

const TRANSCRIPT: TranscriptItem[] = [
  { type: "user", text: "Which shipments have a gap?" },
  { type: "assistant", text: "", toolCalls: [{ id: "t1", name: "list_shipments", input: { coverage_gap_only: true } }] },
  { type: "tool_result", callId: "t1", name: "list_shipments", content: "{\"total\":2}" },
];

describe("provider selection", () => {
  it("prefers LLM_PROVIDER, then Anthropic, then OpenAI, else mock", () => {
    expect(resolveProviderName({})).toBe("mock");
    expect(resolveProviderName({ OPENAI_API_KEY: "o" })).toBe("openai");
    expect(resolveProviderName({ OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" })).toBe("anthropic");
    expect(resolveProviderName({ ANTHROPIC_API_KEY: "a", LLM_PROVIDER: "OpenAI" })).toBe("openai");
  });

  it("builds clients with model overrides and refuses a provider without its key", () => {
    expect(getModelClient({})).toBeNull();
    const a = getModelClient({ ANTHROPIC_API_KEY: "a", ANTHROPIC_MODEL: "custom-model" });
    expect(a).toBeInstanceOf(AnthropicModelClient);
    expect(a?.model).toBe("custom-model");
    expect(getModelClient({ OPENAI_API_KEY: "o" })).toBeInstanceOf(OpenAiModelClient);
    expect(() => getModelClient({ LLM_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
  });

  it("keeps the mock for extraction without keys and rejects unknown providers", () => {
    expect(getLlmClient({})).toBeInstanceOf(MockLlmClient);
    expect(getLlmClient({ ANTHROPIC_API_KEY: "a" })).toBeInstanceOf(ModelExtractionClient);
    expect(() => getLlmClient({ LLM_PROVIDER: "nope" })).toThrow(/Unknown LLM_PROVIDER/);
  });
});

describe("wire formats", () => {
  it("maps a tool round-trip to Anthropic messages", () => {
    const messages = toAnthropicMessages(TRANSCRIPT);
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "list_shipments", input: { coverage_gap_only: true } }],
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "{\"total\":2}" }],
    });
  });

  it("maps a tool round-trip to OpenAI Responses input", () => {
    expect(toOpenAiInput(TRANSCRIPT)).toEqual([
      { role: "user", content: "Which shipments have a gap?" },
      { type: "function_call", call_id: "t1", name: "list_shipments", arguments: "{\"coverage_gap_only\":true}" },
      { type: "function_call_output", call_id: "t1", output: "{\"total\":2}" },
    ]);
  });

  it("parses Anthropic tool_use and OpenAI function_call replies", async () => {
    const anthropic = new AnthropicModelClient("k", "m", async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: "Checking." },
            { type: "tool_use", id: "x", name: "portfolio_summary", input: {} },
          ],
        })
      )
    );
    expect(await anthropic.complete({ system: "s", transcript: TRANSCRIPT })).toEqual({
      text: "Checking.",
      toolCalls: [{ id: "x", name: "portfolio_summary", input: {} }],
    });

    const openai = new OpenAiModelClient("k", "m", async () =>
      new Response(
        JSON.stringify({
          output: [
            { type: "reasoning" },
            { type: "function_call", call_id: "c1", name: "get_risk_profile", arguments: "{\"shipment_id\":\"SH-007\"}" },
          ],
        })
      )
    );
    expect(await openai.complete({ system: "s", transcript: TRANSCRIPT })).toEqual({
      text: "",
      toolCalls: [{ id: "c1", name: "get_risk_profile", input: { shipment_id: "SH-007" } }],
    });
  });
});

describe("live extraction", () => {
  it("extracts JSON from fenced replies", () => {
    expect(parseJsonObject("Here:\n```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(() => parseJsonObject("no json")).toThrow();
  });

  it("validates model output against the extraction schema", async () => {
    const reply = (text: string): ModelClient => ({
      provider: "anthropic",
      model: "m",
      complete: async () => ({ text, toolCalls: [] }),
    });
    const ok = new ModelExtractionClient(reply("{}"));
    // Omitted fields come back as "not present" (null, confidence 0) so the
    // gate flags them — never guessed, never a wholesale failure.
    const result = await ok.extractShipment({ kind: "commercial_invoice", text: "x" });
    expect(result.cargo_hazard.cargoDescription).toEqual({
      value: null,
      confidence: 0,
      evidence: "Field not present in provider response",
    });
    const bad = new ModelExtractionClient(
      reply(JSON.stringify({ cargo_hazard: { cargoDescription: { value: "x", confidence: 2, evidence: "q" } } }))
    );
    await expect(bad.extractShipment({ kind: "commercial_invoice", text: "x" })).rejects.toThrow(/failed the schema/);
  });
});
