import { NextResponse } from "next/server";

import { getCurrentUser } from "@/auth/session";
import { laneForShipment } from "@/conditions/db-lanes";
import { routeConditions } from "@/conditions/service";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map, weather alerts and news for one shipment's lane. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Unknown shipment." }, { status: 404 });
  const lane = await laneForShipment(id);
  if (!lane) return NextResponse.json({ error: "Unknown shipment." }, { status: 404 });
  const conditions = await routeConditions(lane.origin, lane.destination, { mode: lane.mode });
  return NextResponse.json(conditions, { headers: { "Cache-Control": "private, max-age=120" } });
}
