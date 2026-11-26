ALTER TABLE "formal_observation" DROP CONSTRAINT "formal_observation_state_check";--> statement-breakpoint
ALTER TABLE "formal_observation" ADD COLUMN "stop_reason" text;--> statement-breakpoint
ALTER TABLE "formal_observation" ADD CONSTRAINT "formal_observation_state_check" CHECK ("formal_observation"."status" in ('observing', 'checkpoint_due', 'stopped')
    and (
      ("formal_observation"."status" <> 'stopped' and "formal_observation"."stop_reason" is null)
      or ("formal_observation"."status" = 'stopped' and "formal_observation"."stop_reason" is not null and length(trim("formal_observation"."stop_reason")) between 1 and 400)
    )
    and "formal_observation"."frozen_non_brand_count" between 1 and 500
    and length("formal_observation"."frozen_set_id") between 1 and 64
    and length("formal_observation"."effective_on") = 10
    and length("formal_observation"."owner_id") between 1 and 128
    and length("formal_observation"."created_at") between 20 and 40
    and length("formal_observation"."updated_at") between 20 and 40);