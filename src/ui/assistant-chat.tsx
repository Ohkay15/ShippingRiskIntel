"use client";

import { useEffect, useRef, useState } from "react";

import { IconArrowUp, IconSpark, IconTool } from "./icons";
import { MiniMarkdown } from "./mini-markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
  steps?: { tool: string; ok: boolean }[];
}

interface AgentResponse {
  reply: string;
  steps: { tool: string; ok: boolean }[];
  mode: "live" | "offline";
  error?: string;
}

const SUGGESTIONS = [
  "Which shipments have a coverage gap?",
  "What are the riskiest shipments?",
  "Give me a portfolio summary",
  "What's happening in freight?",
  "Which integrations are connected?",
];

const TOOL_LABELS: Record<string, string> = {
  list_shipments: "Searched shipments",
  portfolio_summary: "Summarized portfolio",
  get_risk_profile: "Read risk profile",
  recommend_carriers: "Compared carriers",
  recommend_insurance: "Compared insurance",
  quote_insurance: "Got insurance quote",
  lookup_carrier_safety: "Looked up carrier",
  integration_status: "Checked integrations",
  route_conditions: "Checked route conditions",
  freight_news: "Read freight news",
};

export function AssistantChat({ initialQuestion }: { initialQuestion?: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const askedInitial = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    const next: Message[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setDraft("");
    setPending(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = (await res.json()) as AgentResponse;
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setMessages([...next, { role: "assistant", content: data.reply, steps: data.steps }]);
    } catch (error) {
      setMessages([
        ...next,
        { role: "assistant", content: `Something went wrong: ${error instanceof Error ? error.message : String(error)}` },
      ]);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  useEffect(() => {
    if (initialQuestion && !askedInitial.current) {
      askedInitial.current = true;
      void send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const empty = messages.length === 0 && !pending;

  return (
    <div className={`chat ${empty ? "chat-empty" : ""}`}>
      {empty ? (
        <div className="chat-hero">
          <span className="chat-hero-mark">
            <IconSpark size={22} />
          </span>
          <h1>What do you want to know about your shipments?</h1>
          <p>Answers come from the scoring engine and your connected systems — every number is looked up, never guessed.</p>
        </div>
      ) : (
        <div className="chat-log" aria-live="polite">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="chat-msg chat-msg-user">
                {m.content}
              </div>
            ) : (
              <div key={i} className="chat-msg chat-msg-assistant">
                {m.steps && m.steps.length > 0 && (
                  <div className="chat-steps">
                    {m.steps.map((s, j) => (
                      <span key={j} className={`chat-step ${s.ok ? "" : "chat-step-error"}`}>
                        <IconTool size={12} />
                        {TOOL_LABELS[s.tool] ?? s.tool}
                      </span>
                    ))}
                  </div>
                )}
                <MiniMarkdown text={m.content} />
              </div>
            )
          )}
          {pending && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-thinking" aria-label="Thinking">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          placeholder="Ask about scores, coverage gaps, carriers or insurance…"
          rows={2}
          maxLength={4000}
          aria-label="Message the assistant"
        />
        <div className="composer-bar">
          <button type="submit" className="composer-send" disabled={pending || draft.trim() === ""} aria-label="Send">
            <IconArrowUp />
          </button>
        </div>
      </form>

      {empty && (
        <div className="chat-suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => void send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
