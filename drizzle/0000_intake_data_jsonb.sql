CREATE TYPE "public"."shipment_status" AS ENUM('draft', 'extracting', 'needs_review', 'scored', 'actioned');--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "shipment_status" DEFAULT 'draft' NOT NULL,
	"intake_data" jsonb DEFAULT '{"cargo_hazard":{},"packing_certs":{},"carrier_record":{},"route_lane":{},"live_conditions":{"conditions":[]},"load_type":{},"value_fragility":{},"sensitivity":{},"escalation":{},"coverage":{}}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
