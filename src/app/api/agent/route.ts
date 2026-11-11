import { NextResponse } from "next/server";
import { z } from "zod";

import { runAgent } from "@/agent/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

/** POST { messages: [{ role, content }] } → { reply, steps, mode, model } */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { messages: [{ role, content }] }." }, { status: 422 });
  }
  try {
    return NextResponse.json(await runAgent(parsed.data.messages));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
