CREATE TABLE "monitoring_run" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"track" text NOT NULL,
	"prompt_set_id" text NOT NULL,
	"prompt_set_version" integer NOT NULL,
	"repeat_count" integer NOT NULL,
	"question_count" integer NOT NULL,
	"natural_count" integer NOT NULL,
	"channel_count" integer NOT NULL,
	"slot_count" integer NOT NULL,
	"region" text NOT NULL,
	"language" text NOT NULL,
	"requested_network_mode" text NOT NULL,
	"currency" text,
	"upper_minor" integer,
	"estimate_high_minor" integer,
	"customer_payable_minor" integer NOT NULL,
	"status" text NOT NULL,
	"sampling_complete" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "monitoring_run_scope_check" CHECK ("monitoring_run"."track" in ('model_api', 'consumer_ui')
    and "monitoring_run"."repeat_count" between 1 and 3
    and "monitoring_run"."question_count" > 0 and "monitoring_run"."natural_count" between 0 and "monitoring_run"."question_count"
    and "monitoring_run"."channel_count" > 0 and "monitoring_run"."slot_count" = "monitoring_run"."question_count" * "monitoring_run"."channel_count" * "monitoring_run"."repeat_count"
    and length("monitoring_run"."region") = 2 and length("monitoring_run"."language") between 2 and 40
    and "monitoring_run"."requested_network_mode" in ('on', 'off', 'unknown')
    and "monitoring_run"."status" = 'queued' and "monitoring_run"."sampling_complete" = 0 and "monitoring_run"."customer_payable_minor" = 0
    and (
      ("monitoring_run"."track" = 'consumer_ui' and "monitoring_run"."currency" is null and "monitoring_run"."upper_minor" is null and "monitoring_run"."estimate_high_minor" is null)
      or ("monitoring_run"."track" = 'model_api' and "monitoring_run"."currency" is not null and length("monitoring_run"."currency") = 3
        and "monitoring_run"."upper_minor" >= 0 and "monitoring_run"."estimate_high_minor" = "monitoring_run"."upper_minor" * "monitoring_run"."slot_count")
    ))
);
--> statement-breakpoint
CREATE TABLE "monitoring_slot" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"question_id" text NOT NULL,
	"natural_question" integer NOT NULL,
	"channel_id" text NOT NULL,
	"channel_version" integer NOT NULL,
	"repeat_index" integer NOT NULL,
	"reservation_id" text,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "monitoring_slot_state_check" CHECK ("monitoring_slot"."natural_question" in (0, 1) and "monitoring_slot"."repeat_index" between 1 and 3
    and "monitoring_slot"."channel_version" > 0 and "monitoring_slot"."status" = 'queued')
);
--> statement-breakpoint
ALTER TABLE "monitoring_run" ADD CONSTRAINT "monitoring_run_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_slot" ADD CONSTRAINT "monitoring_slot_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monitoring_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_run_operation_uidx" ON "monitoring_run" USING btree ("brand_id","operation_id");--> statement-breakpoint
CREATE INDEX "monitoring_run_brand_recent_idx" ON "monitoring_run" USING btree ("brand_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_slot_position_uidx" ON "monitoring_slot" USING btree ("run_id","question_id","channel_id","repeat_index");--> statement-breakpoint
CREATE INDEX "monitoring_slot_brand_idx" ON "monitoring_slot" USING btree ("brand_id","run_id");