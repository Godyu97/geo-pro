CREATE TABLE "report_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"action" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "report_decision_state_check" CHECK ("report_decision"."action" in ('continue_content', 'supplement_evidence', 'continue_observation', 'stop')
    and length("report_decision"."id") = 36
    and length("report_decision"."brand_id") = 36
    and length("report_decision"."snapshot_id") = 36
    and length("report_decision"."owner_id") between 1 and 128
    and length("report_decision"."decided_by") between 1 and 128
    and length("report_decision"."decided_at") between 20 and 40
    and length("report_decision"."created_at") between 20 and 40
    and "report_decision"."decided_at" = "report_decision"."created_at")
);
--> statement-breakpoint
ALTER TABLE "report_decision" ADD CONSTRAINT "report_decision_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_decision" ADD CONSTRAINT "report_decision_snapshot_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."report_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_decision_snapshot_action_uidx" ON "report_decision" USING btree ("snapshot_id","action");--> statement-breakpoint
CREATE INDEX "report_decision_brand_idx" ON "report_decision" USING btree ("brand_id","owner_id","decided_at","id");