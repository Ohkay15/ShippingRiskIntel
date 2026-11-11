import { IntegrationRequestError } from "./types";

/**
 * The one HTTP helper every live adapter uses: a hard timeout (an upstream
 * that hangs must never hang a page render), JSON in and out, and errors
 * that name the connector. Injectable `fetchImpl` keeps adapters testable
 * without the network.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface JsonRequest {
  connectorId: string;
  url: string;
  method?: "GET" | "POST" | "PATCH" | "PUT";
  headers?: Record<string, string>;
  body?: unknown;
  /** Send `body` as a pre-encoded string (e.g. form-encoded) instead of JSON. */
  rawBody?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export async function requestJson<T>(req: JsonRequest): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 15_000);
  const fetchImpl = req.fetchImpl ?? fetch;
  try {
    const headers: Record<string, string> = { Accept: "application/json", ...req.headers };
    let body: string | undefined;
    if (req.rawBody !== undefined) {
      body = req.rawBody;
    } else if (req.body !== undefined) {
      body = JSON.stringify(req.body);
      headers["Content-Type"] ??= "application/json";
    }
    const res = await fetchImpl(req.url, {
      method: req.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      throw new IntegrationRequestError(
        req.connectorId,
        `HTTP ${res.status} ${text.slice(0, 300)}`.trim(),
        res.status
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    if (error instanceof IntegrationRequestError) throw error;
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "request timed out"
        : error instanceof Error
          ? error.message
          : String(error);
    throw new IntegrationRequestError(req.connectorId, reason);
  } finally {
    clearTimeout(timer);
  }
}
