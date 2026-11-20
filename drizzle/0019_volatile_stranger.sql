CREATE TABLE "report_retest" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"intent" text NOT NULL,
	"track" text NOT NULL,
	"timezone" text NOT NULL,
	"entity_version" integer NOT NULL,
	"before_run_id" text,
	"after_run_id" text,
	"publication_id" text,
	"effective_at" text,
	"operation_id" text NOT NULL,
	"comparison_json" text,
	"block_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "report_retest_state_check" CHECK ("report_retest"."kind" in ('exploratory', 'd7_reminder', 'diagnostic')
    and "report_retest"."status" in ('scheduled', 'due', 'running', 'completed', 'inconclusive', 'blocked')
    and "report_retest"."intent" in ('business_loop', 'diagnostic')
    and "report_retest"."track" in ('model_api', 'consumer_ui')
    and "report_retest"."entity_version" > 0
    and length("report_retest"."timezone") > 0
    and length("report_retest"."operation_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "report_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"retest_id" text NOT NULL,
	"status" text NOT NULL,
	"grade" text NOT NULL,
	"intent" text NOT NULL,
	"loop_completed" integer NOT NULL,
	"predecessor_id" text,
	"entity_version" integer NOT NULL,
	"timezone" text NOT NULL,
	"locale" text NOT NULL,
	"source_missing" integer NOT NULL,
	"json_bytes" text NOT NULL,
	"html_bytes" text NOT NULL,
	"json_sha256" text NOT NULL,
	"html_sha256" text NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "report_snapshot_state_check" CHECK ("report_snapshot"."status" in ('created', 'superseded')
    and "report_snapshot"."grade" in ('exploratory', 'incomparable')
    and "report_snapshot"."intent" in ('business_loop', 'diagnostic')
    and "report_snapshot"."loop_completed" in (0, 1)
    and "report_snapshot"."source_missing" in (0, 1)
    and "report_snapshot"."entity_version" > 0
    and length("report_snapshot"."json_bytes") > 1
    and length("report_snapshot"."html_bytes") > 1
    and length("report_snapshot"."json_sha256") = 64
    and length("report_snapshot"."html_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "report_todo" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"retest_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"due_at" text NOT NULL,
	"progress_json" text NOT NULL,
	"auto_charge" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "report_todo_state_check" CHECK ("report_todo"."kind" in ('d7_reminder')
    and "report_todo"."status" in ('scheduled', 'due', 'done', 'cancelled')
    and "report_todo"."auto_charge" = 0
    and length("report_todo"."progress_json") > 1)
);
--> statement-breakpoint
ALTER TABLE "report_retest" ADD CONSTRAINT "report_retest_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshot" ADD CONSTRAINT "report_snapshot_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshot" ADD CONSTRAINT "report_snapshot_retest_fk" FOREIGN KEY ("retest_id") REFERENCES "public"."report_retest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_todo" ADD CONSTRAINT "report_todo_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_todo" ADD CONSTRAINT "report_todo_retest_fk" FOREIGN KEY ("retest_id") REFERENCES "public"."report_retest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_retest_operation_uidx" ON "report_retest" USING btree ("brand_id","operation_id");--> statement-breakpoint
CREATE INDEX "report_retest_brand_idx" ON "report_retest" USING btree ("brand_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "report_retest_owner_idx" ON "report_retest" USING btree ("owner_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_snapshot_operation_uidx" ON "report_snapshot" USING btree ("brand_id","operation_id");--> statement-breakpoint
CREATE INDEX "report_snapshot_brand_idx" ON "report_snapshot" USING btree ("brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "report_snapshot_owner_idx" ON "report_snapshot" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "report_snapshot_predecessor_idx" ON "report_snapshot" USING btree ("predecessor_id");--> statement-breakpoint
CREATE INDEX "report_todo_brand_idx" ON "report_todo" USING btree ("brand_id","due_at","id");--> statement-breakpoint
CREATE INDEX "report_todo_owner_idx" ON "report_todo" USING btree ("owner_id","due_at","id");