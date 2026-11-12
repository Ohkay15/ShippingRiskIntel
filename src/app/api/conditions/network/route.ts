import { NextResponse } from "next/server";

import { getCurrentUser } from "@/auth/session";
import { lanesFromDb } from "@/conditions/db-lanes";
import { networkConditions } from "@/conditions/service";

export const dynamic = "force-dynamic";

/** Every lane, plus nationwide severe weather warnings and which lanes they cross. */
export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const conditions = await networkConditions(await lanesFromDb());
  return NextResponse.json(conditions, { headers: { "Cache-Control": "private, max-age=120" } });
}
