ALTER TABLE "sampling_plan" DROP CONSTRAINT "sampling_plan_state_check";--> statement-breakpoint
ALTER TABLE "sampling_plan" ADD COLUMN "trend_threshold_pp" double precision DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "sampling_plan" ADD CONSTRAINT "sampling_plan_state_check" CHECK ("sampling_plan"."version" > 0
    and "sampling_plan"."phase" in ('draft', 'active', 'paused', 'ended')
    and length("sampling_plan"."currency") = 3
    and "sampling_plan"."budget_minor" >= 0 and "sampling_plan"."spent_minor" >= 0 and "sampling_plan"."pending_minor" >= 0
    and "sampling_plan"."trend_threshold_pp" > 0
    and length("sampling_plan"."owner_id") between 1 and 128
    and length("sampling_plan"."created_at") between 20 and 40);