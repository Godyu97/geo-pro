ALTER TABLE "brand_purge" DROP CONSTRAINT "brand_purge_step_check";--> statement-breakpoint
UPDATE "brand_purge" SET "step" = 4 WHERE "step" = 3;--> statement-breakpoint
ALTER TABLE "brand_purge" ADD CONSTRAINT "brand_purge_step_check" CHECK ("brand_purge"."step" between 0 and 4
    and (("brand_purge"."step" = 4 and "brand_purge"."completed_at" is not null and "brand_purge"."issue" is null)
      or ("brand_purge"."step" < 4 and "brand_purge"."completed_at" is null)));