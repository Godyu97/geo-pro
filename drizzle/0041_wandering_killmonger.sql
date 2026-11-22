CREATE TABLE "business_lead" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"event_id" text NOT NULL,
	"primary_class" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "business_lead_state_check" CHECK ("business_lead"."primary_class" in ('referral', 'self_report', 'landing_page', 'unknown')
    and length("business_lead"."event_id") between 1 and 64
    and length("business_lead"."owner_id") between 1 and 128
    and length("business_lead"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "business_lead_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"category" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "business_lead_evidence_state_check" CHECK ("business_lead_evidence"."category" in ('referral', 'self_report', 'landing_page', 'unknown')
    and "business_lead_evidence"."position" between 1 and 4
    and length("business_lead_evidence"."owner_id") between 1 and 128
    and length("business_lead_evidence"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "business_lead" ADD CONSTRAINT "business_lead_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_lead_evidence" ADD CONSTRAINT "business_lead_evidence_lead_id_business_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."business_lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_lead_evidence" ADD CONSTRAINT "business_lead_evidence_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_lead_brand_event_uidx" ON "business_lead" USING btree ("brand_id","event_id");--> statement-breakpoint
CREATE INDEX "business_lead_owner_idx" ON "business_lead" USING btree ("owner_id","brand_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_lead_evidence_lead_idx" ON "business_lead_evidence" USING btree ("lead_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "business_lead_evidence_category_uidx" ON "business_lead_evidence" USING btree ("lead_id","category");