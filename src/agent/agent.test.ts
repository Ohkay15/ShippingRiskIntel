import { describe, expect, it } from "vitest";

import { displayShipmentId } from "@/dashboard/record-id";
import { handleMcpMessage } from "./mcp";
import { classifyOffline, runOfflineAgent } from "./runtime";
import { AGENT_TOOLS, resolveShipmentId } from "./tools";

describe("shipment ids", () => {
  it("resolves demo ids and UUIDs, rejects the rest", () => {
    expect(resolveShipmentId("SH-007")).toBe("00000000-0000-4000-8000-000000000007");
    expect(resolveShipmentId("sh 7")).toBe("00000000-0000-4000-8000-000000000007");
    expect(resolveShipmentId("A6DCFAAF-5DE4-4FA2-8532-73E224BDDD3B")).toBe("a6dcfaaf-5de4-4fa2-8532-73e224bddd3b");
    expect(resolveShipmentId("SH-1000")).toBeNull();
    expect(resolveShipmentId("hello")).toBeNull();
  });

  it("displays demo ids short and others by their first block", () => {
    expect(displayShipmentId("00000000-0000-4000-8000-000000000029")).toBe("SH-029");
    expect(displayShipmentId("a6dcfaaf-5de4-4fa2-8532-73e224bddd3b")).toBe("A6DCFAAF");
  });
});

describe("offline router", () => {
  it.each([
    ["Which shipments have a coverage gap?", "gaps"],
    ["what are the riskiest loads", "riskiest"],
    ["Give me a portfolio summary", "summary"],
    ["anything waiting for review?", "review"],
    ["Which integrations are connected?", "integrations"],
    ["Look up DOT 1234567", "carrier_lookup"],
    ["Explain SH-007", "explain"],
    ["Better carriers for SH-7?", "carriers"],
    ["Quote insurance for SH-012", "insurance"],
    ["Any weather on SH-007's route?", "conditions"],
    ["news for SH-3", "conditions"],
    ["What's the latest freight news?", "news"],
    ["Explain A6DCFAAF", "explain"],
    ["weather on #a6dcfaaf route", "conditions"],
    ["hi", "help"],
  ])("%s → %s", (text, kind) => {
    expect(classifyOffline(text).kind).toBe(kind);
  });

  it("answers help without touching data", async () => {
    const reply = await runOfflineAgent([{ role: "user", content: "hello" }]);
    expect(reply.mode).toBe("offline");
    expect(reply.steps).toEqual([]);
    expect(reply.reply).toContain("offline mode");
  });
});

describe("MCP server", () => {
  it("negotiates the protocol version", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(res).toMatchObject({ result: { protocolVersion: "2025-03-26", serverInfo: { name: "shipping-risk-intel" } } });
    const fallback = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(fallback).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
  });

  it("lists every tool as read-only", async () => {
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" })) as {
      result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    };
    expect(res.result.tools.map((t) => t.name)).toEqual(AGENT_TOOLS.map((t) => t.name));
    expect(res.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it("handles notifications, unknown methods and unknown tools", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "resources/list" })).toMatchObject({ error: { code: -32601 } });
    expect(
      await handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "drop_tables" } })
    ).toMatchObject({ error: { code: -32602 } });
  });
});
