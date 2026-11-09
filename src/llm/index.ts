import type { LlmClient } from "./types";
import { MockLlmClient } from "./mock-provider";

/**
 * Provider registry — the only place that knows which LLM backs extraction.
 * A live provider becomes available by adding one entry here (its factory
 * reads its API key from the environment) and setting LLM_PROVIDER + the
 * key as env secrets. No call-site changes, ever.
 */
const PROVIDERS: Record<string, () => LlmClient> = {
  mock: () => new MockLlmClient(),
};

const DEFAULT_PROVIDER = "mock";

export function getLlmClient(): LlmClient {
  const providerName = process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER;
  const factory = PROVIDERS[providerName];
  if (!factory) {
    throw new Error(
      `Unknown LLM_PROVIDER "${providerName}". Registered providers: ${Object.keys(PROVIDERS).join(", ")}. ` +
        "A live provider is activated by registering its factory here and setting its API key as an environment secret."
    );
  }
  return factory();
}
