ALTER TABLE "competitor_mention" DROP CONSTRAINT "competitor_mention_check";--> statement-breakpoint
ALTER TABLE "competitor_mention" ADD COLUMN "mention_state" text DEFAULT 'true' NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_mention" ADD CONSTRAINT "competitor_mention_check" CHECK ("competitor_mention"."ordered" in (0, 1)
    and "competitor_mention"."mention_state" in ('true', 'false', 'unknown')
    and length("competitor_mention"."competitor_label") between 1 and 80
    and (
      ("competitor_mention"."mention_state" = 'true' and (
        ("competitor_mention"."ordered" = 1 and "competitor_mention"."position" > 0)
        or ("competitor_mention"."ordered" = 0 and "competitor_mention"."position" is null)
      ))
      or ("competitor_mention"."mention_state" in ('false', 'unknown') and "competitor_mention"."ordered" = 0 and "competitor_mention"."position" is null)
    ));