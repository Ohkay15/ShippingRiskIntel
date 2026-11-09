"use server";

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import { buildDemoDataset } from "@/scoring/demo-seed";

export interface DemoSeedState {
  status: "idle" | "error";
  message?: string;
}

/**
 * Load the 40-record synthetic dataset as real rows (fixed UUIDs, profiles
 * computed by the same engine, statuses routed by the same gateway rule).
 * Upsert by fixed id — re-running refreshes demo state instead of
 * duplicating it.
 */
export async function seedDemoDataset(
  _prev: DemoSeedState,
  _formData: FormData
): Promise<DemoSeedState> {
  try {
    const rows = buildDemoDataset();
    await db
      .insert(shipments)
      .values(rows)
      .onConflictDoUpdate({
        target: shipments.id,
        set: {
          status: sql`excluded.status`,
          intakeData: sql`excluded.intake_data`,
          profile: sql`excluded.profile`,
          scoredAt: sql`excluded.scored_at`,
          confirmedFactors: sql`excluded.confirmed_factors`,
          flaggedFields: sql`excluded.flagged_fields`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  } catch (error) {
    return {
      status: "error",
      message: `The demo dataset could not be loaded: ${
        error instanceof Error ? error.message : "unknown error"
      }.`,
    };
  }

  redirect("/");
}
