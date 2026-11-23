CREATE TABLE "sampling_due_run" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version" integer NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"window_id" text NOT NULL,
	"slot_id" text NOT NULL,
	"timezone" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"monitoring_run_id" text,
	"charged_minor" integer NOT NULL,
	"prompt_ids_json" text,
	"created_at" text NOT NULL,
	CONSTRAINT "sampling_due_run_state_check" CHECK ("sampling_due_run"."plan_version" > 0
    and "sampling_due_run"."kind" in ('official', 'manual')
    and "sampling_due_run"."status" in ('reserved', 'accepted', 'sheet')
    and "sampling_due_run"."charged_minor" >= 0
    and length("sampling_due_run"."window_id") = 10
    and length("sampling_due_run"."timezone") between 1 and 64
    and length("sampling_due_run"."channel_id") between 1 and 64
    and length("sampling_due_run"."owner_id") between 1 and 128
    and length("sampling_due_run"."created_at") between 20 and 40
    and (
      ("sampling_due_run"."kind" = 'manual' and "sampling_due_run"."status" = 'sheet'
        and "sampling_due_run"."monitoring_run_id" is null and "sampling_due_run"."charged_minor" = 0
        and "sampling_due_run"."prompt_ids_json" is not null and length("sampling_due_run"."prompt_ids_json") between 38 and 2000)
      or ("sampling_due_run"."kind" = 'official' and "sampling_due_run"."status" = 'reserved'
        and "sampling_due_run"."monitoring_run_id" is null and "sampling_due_run"."charged_minor" = 0 and "sampling_due_run"."prompt_ids_json" is null)
      or ("sampling_due_run"."kind" = 'official' and "sampling_due_run"."status" = 'accepted'
        and "sampling_due_run"."monitoring_run_id" is not null and "sampling_due_run"."prompt_ids_json" is null)
    ))
);
--> statement-breakpoint
CREATE TABLE "sampling_window_reading" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"window_id" text NOT NULL,
	"timezone" text NOT NULL,
	"planned_count" integer NOT NULL,
	"eligible_count" integer NOT NULL,
	"recommended_count" integer NOT NULL,
	"judged_count" integer NOT NULL,
	"coverage_sufficient" integer NOT NULL,
	"comparable_windows" integer NOT NULL,
	"waiting_for_trend" integer NOT NULL,
	"alert_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "sampling_window_reading_state_check" CHECK ("sampling_window_reading"."planned_count" >= 0
    and "sampling_window_reading"."eligible_count" >= 0 and "sampling_window_reading"."recommended_count" >= 0 and "sampling_window_reading"."judged_count" >= 0
    and "sampling_window_reading"."recommended_count" <= "sampling_window_reading"."judged_count"
    and "sampling_window_reading"."coverage_sufficient" in (0, 1) and "sampling_window_reading"."waiting_for_trend" in (0, 1)
    and "sampling_window_reading"."comparable_windows" >= 0
    and length("sampling_window_reading"."window_id") = 10
    and length("sampling_window_reading"."timezone") between 1 and 64
    and length("sampling_window_reading"."owner_id") between 1 and 128
    and length("sampling_window_reading"."created_at") between 20 and 40
    and length("sampling_window_reading"."updated_at") between 20 and 40
    and ("sampling_window_reading"."alert_id" is null or length("sampling_window_reading"."alert_id") = 36))
);
--> statement-breakpoint
ALTER TABLE "sampling_due_run" ADD CONSTRAINT "sampling_due_run_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_due_run" ADD CONSTRAINT "sampling_due_run_slot_id_sampling_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."sampling_slot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_due_run" ADD CONSTRAINT "sampling_due_run_monitoring_run_id_monitoring_run_id_fk" FOREIGN KEY ("monitoring_run_id") REFERENCES "public"."monitoring_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_window_reading" ADD CONSTRAINT "sampling_window_reading_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sampling_due_run_slot_uidx" ON "sampling_due_run" USING btree ("plan_id","channel_id","window_id","slot_id");--> statement-breakpoint
CREATE INDEX "sampling_due_run_owner_idx" ON "sampling_due_run" USING btree ("owner_id","plan_id","window_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sampling_window_reading_window_uidx" ON "sampling_window_reading" USING btree ("plan_id","window_id");--> statement-breakpoint
CREATE INDEX "sampling_window_reading_owner_idx" ON "sampling_window_reading" USING btree ("owner_id","brand_id","window_id");