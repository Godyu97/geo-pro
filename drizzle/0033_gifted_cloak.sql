CREATE TABLE "sampling_plan" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"phase" text NOT NULL,
	"currency" text NOT NULL,
	"budget_minor" integer NOT NULL,
	"spent_minor" integer NOT NULL,
	"pending_minor" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "sampling_plan_id_version_pk" PRIMARY KEY("id","version"),
	CONSTRAINT "sampling_plan_state_check" CHECK ("sampling_plan"."version" > 0
    and "sampling_plan"."phase" in ('draft', 'active', 'paused', 'ended')
    and length("sampling_plan"."currency") = 3
    and "sampling_plan"."budget_minor" >= 0 and "sampling_plan"."spent_minor" >= 0 and "sampling_plan"."pending_minor" >= 0
    and length("sampling_plan"."owner_id") between 1 and 128
    and length("sampling_plan"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "sampling_slot" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"at" text NOT NULL,
	"status" text NOT NULL,
	"manual" integer NOT NULL,
	"cost_minor" integer NOT NULL,
	CONSTRAINT "sampling_slot_state_check" CHECK ("sampling_slot"."status" in ('scheduled', 'completed', 'failed', 'paused')
    and "sampling_slot"."manual" in (0, 1)
    and "sampling_slot"."cost_minor" >= 0
    and length("sampling_slot"."channel_id") between 1 and 64
    and length("sampling_slot"."owner_id") between 1 and 128
    and length("sampling_slot"."at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "sampling_plan" ADD CONSTRAINT "sampling_plan_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_slot" ADD CONSTRAINT "sampling_slot_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sampling_plan_owner_idx" ON "sampling_plan" USING btree ("brand_id","owner_id","id");--> statement-breakpoint
CREATE INDEX "sampling_slot_plan_at_idx" ON "sampling_slot" USING btree ("plan_id","at","id");