import type { LlmClient } from "./types";
import { MockLlmClient } from "./mock-provider";
import { ModelExtractionClient } from "./live-extraction";
import { getModelClient, resolveProviderName } from "./model-client";
import { processEnv } from "@/integrations/status";
import type { EnvSource } from "@/integrations/types";

/**
 * Provider registry — the only place that knows which LLM backs extraction.
 * A provider activates by its API key alone (or LLM_PROVIDER to choose
 * explicitly when several keys are set). No call-site changes, ever.
 *
 *   ANTHROPIC_API_KEY  → Anthropic (model: ANTHROPIC_MODEL)
 *   OPENAI_API_KEY     → OpenAI    (model: OPENAI_MODEL)
 *   neither            → deterministic mock (no network)
 */
const PROVIDERS: Record<string, (env: EnvSource) => LlmClient> = {
  mock: () => new MockLlmClient(),
  anthropic: (env) => new ModelExtractionClient(getModelClient(env)!),
  openai: (env) => new ModelExtractionClient(getModelClient(env)!),
};

export function getLlmClient(env: EnvSource = processEnv()): LlmClient {
  const providerName = resolveProviderName(env);
  const factory = PROVIDERS[providerName];
  if (!factory) {
    throw new Error(
      `Unknown LLM_PROVIDER "${providerName}". Registered providers: ${Object.keys(PROVIDERS).join(", ")}. ` +
        "A live provider is activated by setting its API key as an environment secret."
    );
  }
  return factory(env);
}
