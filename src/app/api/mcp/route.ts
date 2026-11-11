import { NextResponse } from "next/server";

import { handleMcpMessage, type JsonRpcRequest } from "@/agent/mcp";
import { bearerMatches } from "@/integrations/inbound";
import { envValue, processEnv } from "@/integrations/status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * MCP endpoint (stateless Streamable HTTP, JSON responses). Add it to an MCP
 * client as https://<app>/api/mcp with header Authorization: Bearer <MCP_API_KEY>.
 */
export async function POST(request: Request) {
  const secret = envValue(processEnv(), "MCP_API_KEY");
  if (!secret) {
    return NextResponse.json({ error: "MCP server is not enabled. Set MCP_API_KEY in the environment." }, { status: 503 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m) => handleMcpMessage(m as JsonRpcRequest)))).filter(Boolean);
    return responses.length ? NextResponse.json(responses) : new NextResponse(null, { status: 202 });
  }
  const response = await handleMcpMessage(body as JsonRpcRequest);
  return response ? NextResponse.json(response) : new NextResponse(null, { status: 202 });
}

export async function GET() {
  return new NextResponse("This MCP server does not offer an SSE stream; use POST.", { status: 405 });
}
