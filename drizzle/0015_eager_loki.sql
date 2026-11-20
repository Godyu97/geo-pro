CREATE TABLE "optimization_finding" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"gap_type" text NOT NULL,
	"question_cluster" text NOT NULL,
	"target_page" text NOT NULL,
	"observation_id" text,
	"analysis_version_id" text,
	"evidence_summary" text NOT NULL,
	"problem_statement" text NOT NULL,
	"hypothesis" text NOT NULL,
	"assumption_level" text NOT NULL,
	"steps_json" text NOT NULL,
	"completion_criteria" text NOT NULL,
	"retest_method" text NOT NULL,
	"business_importance" integer NOT NULL,
	"estimated_effort" integer NOT NULL,
	"verified_evidence" integer NOT NULL,
	"privacy_risk" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "optimization_finding_state_check" CHECK ("optimization_finding"."gap_type" in ('fact_error', 'name_confusion', 'key_content_missing', 'page_unreadable', 'citation_gap', 'needs_evidence')
    and "optimization_finding"."assumption_level" in ('observed_absence', 'verified', 'pending')
    and "optimization_finding"."business_importance" between 1 and 3
    and "optimization_finding"."estimated_effort" between 1 and 5
    and "optimization_finding"."verified_evidence" in (0, 1)
    and "optimization_finding"."privacy_risk" in (0, 1)
    and length("optimization_finding"."question_cluster") > 0
    and length("optimization_finding"."target_page") > 0)
);
--> statement-breakpoint
CREATE TABLE "optimization_task" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"primary_finding_id" text NOT NULL,
	"gap_type" text NOT NULL,
	"question_cluster" text NOT NULL,
	"target_page" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"priority_bucket" text NOT NULL,
	"manual_rank" integer,
	"reorder_reason" text,
	"completion_note" text,
	"dismiss_reason" text,
	"retest_conclusion" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "optimization_task_state_check" CHECK ("optimization_task"."gap_type" in ('fact_error', 'name_confusion', 'key_content_missing', 'page_unreadable', 'citation_gap', 'needs_evidence')
    and "optimization_task"."status" in ('todo', 'doing', 'blocked', 'implemented', 'retest_pending', 'closed', 'dismissed')
    and "optimization_task"."priority_bucket" in ('urgent', 'normal')
    and ("optimization_task"."manual_rank" is null or "optimization_task"."manual_rank" > 0)
    and (
      ("optimization_task"."status" = 'dismissed' and "optimization_task"."dismiss_reason" is not null)
      or ("optimization_task"."status" <> 'dismissed')
    )
    and (
      ("optimization_task"."manual_rank" is not null and "optimization_task"."reorder_reason" is not null)
      or ("optimization_task"."manual_rank" is null)
    ))
);
--> statement-breakpoint
CREATE TABLE "optimization_task_evidence" (
	"task_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "optimization_task_evidence_task_id_finding_id_pk" PRIMARY KEY("task_id","finding_id")
);
--> statement-breakpoint
CREATE TABLE "page_check_record" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"task_id" text,
	"url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"checked_at" text NOT NULL,
	"access_condition" text NOT NULL,
	"public_status" text NOT NULL,
	"title" text,
	"body_excerpt" text,
	"key_facts_json" text NOT NULL,
	"discoverability_notes" text NOT NULL,
	"contains_executable_instructions" integer NOT NULL,
	"manual_evidence_ref" text,
	"created_at" text NOT NULL,
	CONSTRAINT "page_check_state_check" CHECK ("page_check_record"."public_status" in ('reachable', 'restricted', 'pending_verification', 'not_applicable')
    and "page_check_record"."contains_executable_instructions" in (0, 1)
    and length("page_check_record"."url") > 0
    and length("page_check_record"."normalized_url") > 0)
);
--> statement-breakpoint
ALTER TABLE "optimization_finding" ADD CONSTRAINT "optimization_finding_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_task" ADD CONSTRAINT "optimization_task_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_task" ADD CONSTRAINT "optimization_task_finding_fk" FOREIGN KEY ("primary_finding_id") REFERENCES "public"."optimization_finding"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_task_evidence" ADD CONSTRAINT "optimization_task_evidence_task_fk" FOREIGN KEY ("task_id") REFERENCES "public"."optimization_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_task_evidence" ADD CONSTRAINT "optimization_task_evidence_finding_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."optimization_finding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_check_record" ADD CONSTRAINT "page_check_record_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_check_record" ADD CONSTRAINT "page_check_task_fk" FOREIGN KEY ("task_id") REFERENCES "public"."optimization_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "optimization_finding_brand_idx" ON "optimization_finding" USING btree ("brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "optimization_finding_owner_idx" ON "optimization_finding" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "optimization_finding_dedupe_idx" ON "optimization_finding" USING btree ("brand_id","question_cluster","target_page","gap_type");--> statement-breakpoint
CREATE UNIQUE INDEX "optimization_task_open_dedupe_uidx" ON "optimization_task" USING btree ("brand_id","question_cluster","target_page","gap_type") WHERE "optimization_task"."status" not in ('closed', 'dismissed');--> statement-breakpoint
CREATE INDEX "optimization_task_brand_status_idx" ON "optimization_task" USING btree ("brand_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "optimization_task_owner_idx" ON "optimization_task" USING btree ("owner_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "optimization_task_evidence_brand_idx" ON "optimization_task_evidence" USING btree ("brand_id","task_id","finding_id");--> statement-breakpoint
CREATE INDEX "page_check_brand_idx" ON "page_check_record" USING btree ("brand_id","checked_at","id");--> statement-breakpoint
CREATE INDEX "page_check_owner_idx" ON "page_check_record" USING btree ("owner_id","checked_at","id");