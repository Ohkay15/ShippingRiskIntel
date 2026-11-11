import { AGENT_TOOLS, runTool } from "./tools";

/**
 * Minimal Model Context Protocol server (JSON-RPC 2.0 over stateless HTTP).
 * Exposes the assistant's read-only tools so Claude, ChatGPT and other MCP
 * clients can use the product as a plugin. Pure request → response; the
 * route handles transport and auth.
 */

export const MCP_SERVER_INFO = { name: "shipping-risk-intel", version: "0.1.0" };
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

function ok(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function fail(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/** Returns null for notifications (no response body expected). */
export async function handleMcpMessage(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return fail(msg?.id ?? null, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const requested = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : null;
      return ok(msg.id, {
        protocolVersion:
          requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          "Shipment risk tools: scores are 1–25 (higher is riskier); coverage gap is uncovered USD. Indicative insurance quotes are estimates, not offers.",
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: AGENT_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: true },
        })),
      });
    case "tools/call": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      const args =
        msg.params?.arguments && typeof msg.params.arguments === "object"
          ? (msg.params.arguments as Record<string, unknown>)
          : {};
      if (!AGENT_TOOLS.some((t) => t.name === name)) return fail(msg.id, -32602, `Unknown tool: ${name}`);
      const result = await runTool(name, args);
      return ok(msg.id, { content: [{ type: "text", text: result.content }], isError: !result.ok });
    }
    default:
      if (isNotification) return null;
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
