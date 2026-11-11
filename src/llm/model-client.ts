import { requestJson, type FetchLike } from "@/integrations/http";
import { envValue } from "@/integrations/status";
import type { EnvSource } from "@/integrations/types";

/**
 * Provider-neutral chat-with-tools client. Extraction and the assistant both
 * talk to models only through this interface; Anthropic and OpenAI adapters
 * translate to and from each wire format. No SDK dependencies — plain
 * fetch, so the bundle stays small and every request is visible.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input (type: "object"). */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type TranscriptItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string; toolCalls: ToolCall[] }
  | { type: "tool_result"; callId: string; name: string; content: string; isError?: boolean };

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
}

export interface CompleteOptions {
  system: string;
  transcript: TranscriptItem[];
  tools?: ToolSpec[];
  maxTokens?: number;
}

export interface ModelClient {
  readonly provider: "anthropic" | "openai";
  readonly model: string;
  complete(options: CompleteOptions): Promise<ModelTurn>;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

// ---------------------------------------------------------------------------
// Anthropic Messages API
// ---------------------------------------------------------------------------

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicResponse {
  content?: AnthropicBlock[];
}

export function toAnthropicMessages(transcript: TranscriptItem[]) {
  const messages: { role: "user" | "assistant"; content: string | AnthropicBlock[] }[] = [];
  for (const item of transcript) {
    if (item.type === "user") {
      messages.push({ role: "user", content: item.text });
    } else if (item.type === "assistant") {
      const blocks: AnthropicBlock[] = [];
      if (item.text) blocks.push({ type: "text", text: item.text });
      for (const call of item.toolCalls) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      messages.push({ role: "assistant", content: blocks.length ? blocks : item.text });
    } else {
      const block: AnthropicBlock = {
        type: "tool_result",
        tool_use_id: item.callId,
        content: item.content,
        ...(item.isError ? { is_error: true } : {}),
      };
      // Consecutive tool results travel together in one user turn.
      const last = messages.at(-1);
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        messages.push({ role: "user", content: [block] });
      }
    }
  }
  return messages;
}

export class AnthropicModelClient implements ModelClient {
  readonly provider = "anthropic" as const;
  constructor(
    private readonly apiKey: string,
    readonly model: string = DEFAULT_ANTHROPIC_MODEL,
    private readonly fetchImpl?: FetchLike
  ) {}

  async complete(options: CompleteOptions): Promise<ModelTurn> {
    const data = await requestJson<AnthropicResponse>({
      connectorId: "anthropic",
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: {
        model: this.model,
        max_tokens: options.maxTokens ?? 2048,
        system: options.system,
        messages: toAnthropicMessages(options.transcript),
        ...(options.tools?.length
          ? {
              tools: options.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
              })),
            }
          : {}),
      },
      timeoutMs: 60_000,
      fetchImpl: this.fetchImpl,
    });
    const blocks = data.content ?? [];
    return {
      text: blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim(),
      toolCalls: blocks
        .filter((b): b is Extract<AnthropicBlock, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} })),
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI Responses API
// ---------------------------------------------------------------------------

type OpenAiOutputItem =
  | { type: "message"; content?: { type: string; text?: string }[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: string };

interface OpenAiResponse {
  output?: OpenAiOutputItem[];
}

export function toOpenAiInput(transcript: TranscriptItem[]) {
  const input: Record<string, unknown>[] = [];
  for (const item of transcript) {
    if (item.type === "user") {
      input.push({ role: "user", content: item.text });
    } else if (item.type === "assistant") {
      if (item.text) input.push({ role: "assistant", content: item.text });
      for (const call of item.toolCalls) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.input),
        });
      }
    } else {
      input.push({ type: "function_call_output", call_id: item.callId, output: item.content });
    }
  }
  return input;
}

function safeJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class OpenAiModelClient implements ModelClient {
  readonly provider = "openai" as const;
  constructor(
    private readonly apiKey: string,
    readonly model: string = DEFAULT_OPENAI_MODEL,
    private readonly fetchImpl?: FetchLike
  ) {}

  async complete(options: CompleteOptions): Promise<ModelTurn> {
    const data = await requestJson<OpenAiResponse>({
      connectorId: "openai",
      url: "https://api.openai.com/v1/responses",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: {
        model: this.model,
        instructions: options.system,
        input: toOpenAiInput(options.transcript),
        max_output_tokens: options.maxTokens ?? 2048,
        ...(options.tools?.length
          ? {
              tools: options.tools.map((t) => ({
                type: "function",
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              })),
            }
          : {}),
      },
      timeoutMs: 60_000,
      fetchImpl: this.fetchImpl,
    });
    const output = data.output ?? [];
    const text = output
      .filter((o): o is Extract<OpenAiOutputItem, { type: "message" }> => o.type === "message")
      .flatMap((o) => o.content ?? [])
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    const toolCalls = output
      .filter((o): o is Extract<OpenAiOutputItem, { type: "function_call" }> => o.type === "function_call")
      .map((o) => ({ id: o.call_id, name: o.name, input: safeJsonObject(o.arguments) }));
    return { text, toolCalls };
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type ProviderName = "anthropic" | "openai" | "mock";

/**
 * LLM_PROVIDER wins when set. Otherwise the first provider with a key is
 * used (Anthropic, then OpenAI); no key at all means the mock.
 */
export function resolveProviderName(env: EnvSource): string {
  const explicit = envValue(env, "LLM_PROVIDER");
  if (explicit) return explicit.toLowerCase();
  if (envValue(env, "ANTHROPIC_API_KEY")) return "anthropic";
  if (envValue(env, "OPENAI_API_KEY")) return "openai";
  return "mock";
}

/** A live model client, or null when the resolved provider is the mock. */
export function getModelClient(env: EnvSource, fetchImpl?: FetchLike): ModelClient | null {
  const name = resolveProviderName(env);
  if (name === "anthropic") {
    const key = envValue(env, "ANTHROPIC_API_KEY");
    if (!key) throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
    return new AnthropicModelClient(key, envValue(env, "ANTHROPIC_MODEL") ?? DEFAULT_ANTHROPIC_MODEL, fetchImpl);
  }
  if (name === "openai") {
    const key = envValue(env, "OPENAI_API_KEY");
    if (!key) throw new Error("LLM_PROVIDER=openai but OPENAI_API_KEY is not set.");
    return new OpenAiModelClient(key, envValue(env, "OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL, fetchImpl);
  }
  return null;
}
