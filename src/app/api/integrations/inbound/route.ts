import { NextResponse } from "next/server";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import { bearerMatches, parseInboundLoad } from "@/integrations/inbound";
import { appBaseUrl } from "@/integrations/publish";
import { envValue, processEnv } from "@/integrations/status";
import { scoreShipmentRecord } from "@/scoring/service";

export const dynamic = "force-dynamic";

/**
 * POST a load from any TMS or automation; it lands as a draft shipment
 * (optionally scored right away).
 *
 *   curl -X POST $APP/api/integrations/inbound \
 *     -H "Authorization: Bearer $INBOUND_WEBHOOK_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"source":"mcleod","externalRef":"L-1042","score":true,
 *          "intake":{"cargo_hazard":{"cargoDescription":"Lithium batteries"}}}'
 */
export async function POST(request: Request) {
  const env = processEnv();
  const secret = envValue(env, "INBOUND_WEBHOOK_SECRET");
  if (!secret) {
    return NextResponse.json(
      { error: "Inbound webhook is not enabled. Set INBOUND_WEBHOOK_SECRET in the environment." },
      { status: 503 }
    );
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = parseInboundLoad(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, issues: parsed.issues ?? [] }, { status: 422 });
  }

  const [row] = await db
    .insert(shipments)
    .values({ status: "draft", intakeData: parsed.intake })
    .returning({ id: shipments.id });

  let status: string = "draft";
  let score: number | null = null;
  if (parsed.score) {
    const outcome = await scoreShipmentRecord(row.id);
    status = outcome.status;
    score = outcome.profile.score;
  }

  const base = appBaseUrl(env);
  return NextResponse.json(
    {
      id: row.id,
      source: parsed.source,
      externalRef: parsed.externalRef,
      status,
      score,
      url: base ? `${base}/shipments/${row.id}` : `/shipments/${row.id}`,
    },
    { status: 201 }
  );
}
