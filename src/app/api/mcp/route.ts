import { NextResponse } from "next/server";

import { handleMcpMessage, type JsonRpcRequest } from "@/agent/mcp";
import { userFromApiKey } from "@/auth/session";
import { bearerMatches } from "@/integrations/inbound";
import { envValue, processEnv } from "@/integrations/status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * MCP endpoint (stateless Streamable HTTP, JSON responses). Add it to an MCP
 * client as https://<app>/api/mcp with header
 *   Authorization: Bearer <personal API key from Settings>
 * or, for a shared service key, Bearer <MCP_API_KEY>.
 */
async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization");
  const serviceKey = envValue(processEnv(), "MCP_API_KEY");
  if (serviceKey && bearerMatches(header, serviceKey)) return true;
  return (await userFromApiKey(header)) !== null;
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json(
      { error: "Unauthorized. Create a personal API key under Settings and send it as a Bearer token." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
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
