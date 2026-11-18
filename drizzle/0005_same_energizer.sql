DROP INDEX "brand_active_owner_uidx";--> statement-breakpoint
ALTER TABLE "brand" ADD COLUMN "frozen_at" text;--> statement-breakpoint
ALTER TABLE "brand" ADD COLUMN "restore_until" text;--> statement-breakpoint
CREATE INDEX "brand_owner_frozen_idx" ON "brand" USING btree ("owner_id","frozen_at","id") WHERE "brand"."frozen_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_active_owner_uidx" ON "brand" USING btree ("owner_id") WHERE "brand"."status" = 'active' and "brand"."frozen_at" is null;