import { getModelClient, type ModelClient, type TranscriptItem } from "@/llm/model-client";
import { processEnv } from "@/integrations/status";
import type { EnvSource } from "@/integrations/types";
import { AGENT_TOOLS, displayShipmentId, resolveShipmentId, runTool } from "./tools";

/**
 * The assistant loop. With a model key it is a real tool-using agent; with
 * none it runs an offline router over the SAME tools, so the assistant is
 * useful (and honest about its mode) before any key exists.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
}

export interface AgentReply {
  reply: string;
  steps: AgentStep[];
  mode: "live" | "offline";
  model: string | null;
}

export const MAX_TOOL_ROUNDS = 6;

export function systemPrompt(today: string): string {
  return [
    "You are the assistant inside a shipment risk tool used by freight brokers, shippers and 3PL operators.",
    `Today is ${today}.`,
    "How the product works: each shipment is scored on ten risk factors (likelihood × consequence × weight) into a composite on a 1–25 scale (higher = riskier) and a matrix cell (LL, LH, HL, HH; HH is worst). The coverage gap is declared value minus effective coverage (the lower of insurance and carrier liability); a positive gap is uncovered dollars.",
    "Rules:",
    "- Every number you state must come from a tool result in this conversation. If you have not looked it up, call a tool. Never estimate a score, gap or premium yourself.",
    "- Say where a rating came from when it matters (rule, document evidence, human review, or conservative default).",
    "- Insurance quotes marked 'indicative' are estimates, not offers. Say so.",
    "- You cannot change records. To act (resolve a review, pick a carrier or insurer), point the user to the record page link.",
    "- Weather alerts come from the National Weather Service (US only) and news from GDELT. Name the source, link articles, and don't treat a headline as confirmed impact on a shipment. A lane marked approximate is a straight line, not the road route.",
    "- Refer to shipments by their short id (e.g. SH-007) and include the record link from tool results as a markdown link.",
    "- Be brief and specific: lead with the answer, then at most a short list. No preamble.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Live agent
// ---------------------------------------------------------------------------

export async function runLiveAgent(model: ModelClient, history: ChatTurn[], now = new Date()): Promise<AgentReply> {
  const transcript: TranscriptItem[] = history.map((t) =>
    t.role === "user" ? { type: "user", text: t.content } : { type: "assistant", text: t.content, toolCalls: [] }
  );
  const steps: AgentStep[] = [];
  const tools = AGENT_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const turn = await model.complete({
      system: systemPrompt(now.toISOString().slice(0, 10)),
      transcript,
      tools: round < MAX_TOOL_ROUNDS ? tools : undefined,
      maxTokens: 1500,
    });
    if (turn.toolCalls.length === 0) {
      return { reply: turn.text || "I don't have an answer for that.", steps, mode: "live", model: `${model.provider}:${model.model}` };
    }
    transcript.push({ type: "assistant", text: turn.text, toolCalls: turn.toolCalls });
    for (const call of turn.toolCalls) {
      const result = await runTool(call.name, call.input);
      steps.push({ tool: call.name, input: call.input, ok: result.ok });
      transcript.push({ type: "tool_result", callId: call.id, name: call.name, content: result.content, isError: !result.ok });
    }
  }
  return {
    reply: "I ran out of steps before finishing. Try a narrower question.",
    steps,
    mode: "live",
    model: `${model.provider}:${model.model}`,
  };
}

// ---------------------------------------------------------------------------
// Offline router (no model key)
// ---------------------------------------------------------------------------

const usd = (n: number | null | undefined) =>
  n == null
    ? "unknown"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface Headline {
  id: string;
  summary: string;
  status: string;
  score: number | null;
  cell: string | null;
  coverageGapUsd: number | null;
  link: string;
}

function headlineLine(h: Headline): string {
  const gap = h.coverageGapUsd != null && h.coverageGapUsd > 0 ? ` · **${usd(h.coverageGapUsd)} uncovered**` : "";
  const score = h.score != null ? `score ${h.score.toFixed(1)} (${h.cell})` : h.status;
  return `- [${h.id}](${h.link}) — ${h.summary} · ${score}${gap}`;
}

export const OFFLINE_HELP = [
  "I'm running in offline mode (no AI model key yet), so I answer a fixed set of questions using the same tools. Try:",
  "- **Which shipments have a coverage gap?**",
  "- **What are the riskiest shipments?**",
  "- **Give me a portfolio summary**",
  "- **Explain SH-007** · **Carriers for SH-007** · **Quote insurance for SH-007**",
  "- **Weather and news on SH-007's route** · **What's happening in freight?**",
  "- **Look up DOT 1234567**",
  "- **Which integrations are connected?**",
  "",
  "Add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the environment for free-form questions.",
].join("\n");

function findShipmentRef(text: string): string | null {
  const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (uuid) return uuid;
  const demo = text.match(/\bsh[-\s]?\d{1,3}\b/i)?.[0];
  return demo && resolveShipmentId(demo) ? demo : null;
}

export type OfflineIntent =
  | { kind: "gaps" }
  | { kind: "riskiest" }
  | { kind: "summary" }
  | { kind: "review" }
  | { kind: "integrations" }
  | { kind: "carrier_lookup"; dot: string }
  | { kind: "carriers"; ref: string }
  | { kind: "insurance"; ref: string }
  | { kind: "explain"; ref: string }
  | { kind: "conditions"; ref: string }
  | { kind: "news" }
  | { kind: "help" };

export function classifyOffline(text: string): OfflineIntent {
  const t = text.toLowerCase();
  const dot = t.match(/\b(?:us)?dot\s*#?\s*(\d{3,8})\b/)?.[1];
  if (dot) return { kind: "carrier_lookup", dot };
  const ref = findShipmentRef(text);
  if (ref) {
    if (/weather|radar|storm|alert|snow|conditions|road|news|route|lane/.test(t)) return { kind: "conditions", ref };
    if (/\bcarrier|swap|truck|haul/.test(t)) return { kind: "carriers", ref };
    if (/insur|quote|premium|cover/.test(t)) return { kind: "insurance", ref };
    return { kind: "explain", ref };
  }
  if (/\bnews\b|headlines|happening in freight|supply chain/.test(t)) return { kind: "news" };
  if (/integration|connector|connected|api key/.test(t)) return { kind: "integrations" };
  if (/gap|uncovered|underinsured|under-insured|exposure/.test(t)) return { kind: "gaps" };
  if (/riskiest|highest|worst|top risk|most risk|dangerous/.test(t)) return { kind: "riskiest" };
  if (/summary|overview|portfolio|how many|total/.test(t)) return { kind: "summary" };
  if (/review|flagged|pending/.test(t)) return { kind: "review" };
  return { kind: "help" };
}

async function tool<T>(name: string, input: Record<string, unknown>, steps: AgentStep[]): Promise<T> {
  const result = await runTool(name, input);
  steps.push({ tool: name, input, ok: result.ok });
  if (!result.ok) throw new Error(result.content.replace(/^Error:\s*/, ""));
  return result.data as T;
}

export async function runOfflineAgent(history: ChatTurn[]): Promise<AgentReply> {
  const last = [...history].reverse().find((t) => t.role === "user")?.content ?? "";
  const intent = classifyOffline(last);
  const steps: AgentStep[] = [];
  const done = (reply: string): AgentReply => ({ reply, steps, mode: "offline", model: null });

  try {
    switch (intent.kind) {
      case "gaps": {
        const r = await tool<{ total: number; shipments: Headline[] }>(
          "list_shipments",
          { coverage_gap_only: true, sort: "gap", limit: 8 },
          steps
        );
        if (r.total === 0) return done("No shipment has uncovered dollars right now.");
        const sum = r.shipments.reduce((a, s) => a + (s.coverageGapUsd ?? 0), 0);
        return done(
          `**${r.total} shipment${r.total === 1 ? "" : "s"}** carry a coverage gap. The largest ${r.shipments.length} add up to **${usd(sum)}** uncovered:\n\n${r.shipments.map(headlineLine).join("\n")}`
        );
      }
      case "riskiest": {
        const r = await tool<{ shipments: Headline[] }>("list_shipments", { sort: "score", limit: 5 }, steps);
        return done(`The riskiest shipments by composite score:\n\n${r.shipments.map(headlineLine).join("\n")}`);
      }
      case "review": {
        const r = await tool<{ total: number; shipments: Headline[] }>(
          "list_shipments",
          { status: "needs_review", sort: "score", limit: 8 },
          steps
        );
        if (r.total === 0) return done("Nothing is waiting for review.");
        return done(
          `**${r.total}** record${r.total === 1 ? " is" : "s are"} waiting for review ([open the queue](/review)):\n\n${r.shipments.map(headlineLine).join("\n")}`
        );
      }
      case "summary": {
        const r = await tool<{
          records: number;
          byStatus: Record<string, number>;
          byMatrixCell: Record<string, number>;
          uncoveredUsdTotal: number | null;
          recordsWithCoverageGap: number;
          recordsWithUnknownCoverage: number;
          riskiest: Headline[];
        }>("portfolio_summary", {}, steps);
        const status = Object.entries(r.byStatus)
          .map(([k, v]) => `${v} ${k.replace("_", " ")}`)
          .join(", ");
        return done(
          [
            `**${r.records} records** — ${status}.`,
            `**${usd(r.uncoveredUsdTotal)} uncovered** across ${r.recordsWithCoverageGap} shipments; ${r.recordsWithUnknownCoverage} have unknown coverage.`,
            `Matrix: ${["HH", "HL", "LH", "LL"].map((c) => `${c} ${r.byMatrixCell[c] ?? 0}`).join(" · ")}.`,
            "",
            "Riskiest right now:",
            ...r.riskiest.map(headlineLine),
          ].join("\n")
        );
      }
      case "integrations": {
        const r = await tool<{ category: string; connectors: { name: string; status: string }[] }[]>(
          "integration_status",
          {},
          steps
        );
        const all = r.flatMap((g) => g.connectors);
        const connected = all.filter((c) => c.status === "Connected").map((c) => c.name);
        const ready = all.filter((c) => c.status.startsWith("Ready")).map((c) => c.name);
        return done(
          [
            connected.length ? `**Connected:** ${connected.join(", ")}.` : "**Nothing is connected yet** — everything runs on built-in sample data.",
            `**Ready for a key (${ready.length}):** ${ready.join(", ")}.`,
            "See [Integrations](/integrations) for the exact environment variables.",
          ].join("\n\n")
        );
      }
      case "conditions": {
        const r = await tool<{
          shipment: string;
          link: string;
          origin: string | null;
          destination: string | null;
          laneKm: number | null;
          alerts: { event: string; severity: string; area: string; until: string | null }[];
          news: { title: string; source: string; url: string }[];
          issues: string[];
        }>("route_conditions", { shipment_id: intent.ref }, steps);
        const lane = r.origin && r.destination ? `${r.origin} → ${r.destination}` : "this lane";
        const km = r.laneKm != null ? ` (~${Math.round(r.laneKm * 0.621).toLocaleString("en-US")} mi)` : "";
        const alerts = r.alerts.length
          ? r.alerts.map((a) => `- **${a.event}** (${a.severity.toLowerCase()}) — ${a.area.split(";").slice(0, 3).join(";")}${a.until ? ` · until ${new Date(a.until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}`)
          : ["- No active weather alerts along the lane."];
        const news = r.news.length ? r.news.slice(0, 4).map((n) => `- [${n.title}](${n.url}) · ${n.source}`) : [];
        return done(
          [
            `**${r.shipment}** · ${lane}${km}. [Open the map with radar](${r.link}).`,
            "",
            "**Weather alerts**",
            ...alerts,
            ...(news.length ? ["", "**In the news**", ...news] : []),
            ...(r.issues.length ? ["", `_${r.issues.join(" ")}_`] : []),
          ].join("\n")
        );
      }
      case "news": {
        const items = await tool<{ title: string; source: string; url: string }[]>("freight_news", {}, steps);
        if (items.length === 0) return done("No freight news came back just now. Try again in a minute.");
        return done(["**Freight news, last 48 hours**", "", ...items.slice(0, 8).map((n) => `- [${n.title}](${n.url}) · ${n.source}`)].join("\n"));
      }
      case "carrier_lookup": {
        const r = await tool<{
          legalName: string | null;
          source: string;
          dotNumber: string;
          suggestedSafetyRating: number;
          ratingReason: string;
          allowedToOperate: boolean | null;
        }>("lookup_carrier_safety", { dot_number: intent.dot }, steps);
        return done(
          `**${r.legalName ?? `DOT ${r.dotNumber}`}** (DOT ${r.dotNumber}) — suggested safety rating **${r.suggestedSafetyRating}/5** (1 is safest). ${r.ratingReason}${r.allowedToOperate === false ? " **Not authorized to operate.**" : ""}`
        );
      }
      case "explain": {
        const r = await tool<
          Headline & {
            provisional?: boolean;
            note?: string;
            factors?: { factor: string; likelihood: number; consequence: number; contribution: number; basis: string }[];
          }
        >("get_risk_profile", { shipment_id: intent.ref }, steps);
        if (!r.factors) return done(`[${r.id}](${r.link}) — ${r.note ?? "not scored yet"}`);
        const drivers = r.factors
          .slice(0, 3)
          .map((f) => `- **${f.factor}** — L${f.likelihood} × C${f.consequence}, adds ${f.contribution.toFixed(2)} · ${f.basis}`);
        return done(
          [
            `[${r.id}](${r.link}) scores **${r.score?.toFixed(1)}** (${r.cell})${r.provisional ? ", provisional until review" : ""}. Coverage gap: **${usd(r.coverageGapUsd)}**.`,
            "",
            "Top drivers:",
            ...drivers,
          ].join("\n")
        );
      }
      case "carriers": {
        const r = await tool<{
          shipment: string;
          currentScore: number;
          recommendations: { carrier: string; projectedScore: number; scoreDelta: number }[];
        }>("recommend_carriers", { shipment_id: intent.ref }, steps);
        if (r.recommendations.length === 0) return done(`No carrier in the fit matrix suits ${r.shipment}.`);
        return done(
          [
            `Carrier swaps for **${r.shipment}** (now ${r.currentScore.toFixed(1)}):`,
            ...r.recommendations.map(
              (c) => `- **${c.carrier}** → ${c.projectedScore.toFixed(1)} (${c.scoreDelta > 0 ? "+" : ""}${c.scoreDelta.toFixed(2)})`
            ),
            "",
            "Pick one on the record page to action it.",
          ].join("\n")
        );
      }
      case "insurance": {
        const q = await tool<{
          shipment: string;
          insuring: string;
          kind: string;
          productName: string;
          insuredAmountUsd: number;
          premiumUsd: number;
          ratePer100Usd: number;
          deductibleUsd: number;
        }>("quote_insurance", { shipment_id: intent.ref }, steps);
        return done(
          [
            `**${q.kind === "live" ? "Live" : "Indicative"} quote** for ${q.shipment} — insuring ${q.insuring === "gap" ? "the coverage gap" : "full value"} of **${usd(q.insuredAmountUsd)}**:`,
            `- Premium **${usd(q.premiumUsd)}** (${q.ratePer100Usd.toFixed(2)} per $100) · deductible ${usd(q.deductibleUsd)}`,
            `- ${q.productName}`,
            q.kind === "live" ? "" : "\nThis is an estimate, not an offer. Connect an insurance partner on the [Integrations](/integrations) page for live quotes.",
          ].join("\n")
        );
      }
      case "help":
        return done(OFFLINE_HELP);
    }
  } catch (error) {
    return done(`I couldn't answer that: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runAgent(history: ChatTurn[], env: EnvSource = processEnv()): Promise<AgentReply> {
  const trimmed = history.slice(-20);
  const model = getModelClient(env);
  if (!model) return runOfflineAgent(trimmed);
  try {
    return await runLiveAgent(model, trimmed);
  } catch (error) {
    const offline = await runOfflineAgent(trimmed);
    const reason = error instanceof Error ? error.message : String(error);
    return { ...offline, reply: `_The AI model is unavailable (${reason.slice(0, 160)}), so this answer is from offline mode._\n\n${offline.reply}` };
  }
}

export { displayShipmentId };
