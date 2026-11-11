import { NextResponse } from "next/server";

import { integrationStatusReport, processEnv, statusCounts } from "@/integrations/status";

export const dynamic = "force-dynamic";

/** Connector status as JSON — names env vars, never their values. */
export async function GET() {
  const report = integrationStatusReport(processEnv());
  return NextResponse.json({
    counts: statusCounts(report),
    categories: report.map((group) => ({
      category: group.category,
      connectors: group.connectors.map((c) => ({
        id: c.def.id,
        name: c.def.name,
        status: c.status,
        access: c.def.access,
        implementation: c.def.implementation,
        missingEnv: c.missingEnv,
      })),
    })),
  });
}
