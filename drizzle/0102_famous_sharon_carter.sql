ALTER TABLE "capture_attempt" DROP CONSTRAINT "capture_attempt_state_check";--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "prompt_id" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "question_text" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "answer_text" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "citations_json" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "citation_set_state" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "locator_ref" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "collector_id" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "requested_network_mode" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "target_region" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "observed_region" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "new_session" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "product_mode" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD COLUMN "observation_id" text;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD CONSTRAINT "capture_attempt_observation_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."answer_observation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD CONSTRAINT "capture_attempt_state_check" CHECK ("capture_attempt"."status" in ('handoff', 'partial', 'preview')
    and "capture_attempt"."confirmed" in (0, 1)
    and "capture_attempt"."citation_count" between 0 and 1000
    and (
      ("capture_attempt"."blocked_by" in ('captcha', 'login') and "capture_attempt"."status" = 'handoff' and "capture_attempt"."confirmed" = 0)
      or ("capture_attempt"."blocked_by" is null and "capture_attempt"."citation_count" = 0 and "capture_attempt"."status" = 'partial')
      or ("capture_attempt"."blocked_by" is null and "capture_attempt"."citation_count" between 1 and 1000 and "capture_attempt"."status" = 'preview')
    )
    and length("capture_attempt"."id") = 36
    and length("capture_attempt"."sheet_id") = 36
    and length("capture_attempt"."brand_id") = 36
    and length("capture_attempt"."owner_id") between 1 and 128
    and ("capture_attempt"."blocked_by" is null or length("capture_attempt"."blocked_by") between 5 and 7)
    and length("capture_attempt"."created_at") between 20 and 40
    and length("capture_attempt"."updated_at") between 20 and 40
    and ("capture_attempt"."prompt_id" is null or length("capture_attempt"."prompt_id") = 36)
    and ("capture_attempt"."citation_set_state" is null or "capture_attempt"."citation_set_state" in ('complete', 'partial', 'unsupported', 'missing'))
    and ("capture_attempt"."requested_network_mode" is null or "capture_attempt"."requested_network_mode" in ('on', 'off', 'unknown'))
    and ("capture_attempt"."target_region" is null or length("capture_attempt"."target_region") = 2)
    and ("capture_attempt"."observed_region" is null or "capture_attempt"."observed_region" = 'unknown' or length("capture_attempt"."observed_region") = 2)
    and ("capture_attempt"."new_session" is null or "capture_attempt"."new_session" in ('true', 'false', 'unknown'))
    and ("capture_attempt"."product_mode" is null or "capture_attempt"."product_mode" in ('true', 'false', 'unknown'))
    and ("capture_attempt"."observation_id" is null or (length("capture_attempt"."observation_id") = 36 and "capture_attempt"."confirmed" = 1 and "capture_attempt"."status" in ('partial', 'preview'))));