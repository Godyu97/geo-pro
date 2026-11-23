ALTER TABLE "answer_observation" DROP CONSTRAINT "answer_observation_state_check";--> statement-breakpoint
ALTER TABLE "answer_observation" ADD COLUMN "target_region" text;--> statement-breakpoint
UPDATE "answer_observation" SET "target_region" = "region";--> statement-breakpoint
ALTER TABLE "answer_observation" ALTER COLUMN "target_region" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "answer_observation" ADD COLUMN "observed_region" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "answer_observation" ADD COLUMN "new_session" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "answer_observation" ADD COLUMN "product_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "answer_observation" ADD CONSTRAINT "answer_observation_state_check" CHECK ("answer_observation"."source_mode" in ('model_api', 'consumer_ui')
    and "answer_observation"."capture_method" in ('official_api', 'manual', 'assisted', 'isolated')
    and "answer_observation"."citation_set_state" in ('complete', 'partial', 'unsupported', 'missing')
    and "answer_observation"."evidence_state" in ('draft_evidence', 'complete', 'incomplete', 'contested')
    and "answer_observation"."entity_version" > 0 and length("answer_observation"."fingerprint") = 64
    and length("answer_observation"."region") = 2 and length("answer_observation"."language") between 2 and 40
    and "answer_observation"."requested_network_mode" in ('on', 'off', 'unknown')
    and length("answer_observation"."target_region") = 2
    and ("answer_observation"."observed_region" = 'unknown' or length("answer_observation"."observed_region") = 2)
    and "answer_observation"."new_session" in ('true', 'false', 'unknown')
    and "answer_observation"."product_mode" in ('true', 'false', 'unknown')
    and (
      ("answer_observation"."evidence_state" = 'draft_evidence')
      or ("answer_observation"."evidence_state" in ('complete', 'incomplete', 'contested') and length("answer_observation"."answer_text") > 0)
    )
    and (
      ("answer_observation"."source_mode" = 'consumer_ui' and "answer_observation"."capture_method" in ('manual', 'assisted'))
      or ("answer_observation"."source_mode" = 'model_api' and "answer_observation"."capture_method" in ('official_api', 'isolated', 'assisted'))
    ));