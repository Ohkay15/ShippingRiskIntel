import { NextResponse } from "next/server";

import { getCurrentUser } from "@/auth/session";
import { networkNews } from "@/conditions/service";

export const dynamic = "force-dynamic";

/** Freight and supply-chain headlines (GDELT). */
export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  try {
    const items = await networkNews();
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ items: [], issue: "News is unavailable right now." });
  }
}
