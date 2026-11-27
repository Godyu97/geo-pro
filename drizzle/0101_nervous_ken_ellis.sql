ALTER TABLE "whitelabel_share" DROP CONSTRAINT "whitelabel_share_state_check";--> statement-breakpoint
ALTER TABLE "whitelabel_share" ADD COLUMN "snapshot_id" text;--> statement-breakpoint
ALTER TABLE "whitelabel_share" ADD COLUMN "limitations_json" text;--> statement-breakpoint
ALTER TABLE "whitelabel_share" ADD COLUMN "sample_summary_json" text;--> statement-breakpoint
ALTER TABLE "whitelabel_share" ADD CONSTRAINT "whitelabel_share_snapshot_id_report_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."report_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whitelabel_share_brand_idx" ON "whitelabel_share" USING btree ("brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "whitelabel_share_snapshot_idx" ON "whitelabel_share" USING btree ("snapshot_id");--> statement-breakpoint
ALTER TABLE "whitelabel_share" ADD CONSTRAINT "whitelabel_share_state_check" CHECK ("whitelabel_share"."revoked" in (0, 1)
    and "whitelabel_share"."sample_size" between 0 and 2000000000
    and "whitelabel_share"."track" ~ '^[a-z0-9_]{1,64}$'
    and "whitelabel_share"."grade" ~ '^[a-z0-9_]{1,32}$'
    and length("whitelabel_share"."id") = 36
    and length("whitelabel_share"."brand_id") = 36
    and length("whitelabel_share"."owner_id") between 1 and 128
    and ("whitelabel_share"."snapshot_id" is null or length("whitelabel_share"."snapshot_id") = 36)
    and ("whitelabel_share"."limitations_json" is null or length("whitelabel_share"."limitations_json") >= 2)
    and ("whitelabel_share"."sample_summary_json" is null or length("whitelabel_share"."sample_summary_json") >= 2)
    and length("whitelabel_share"."expires_at") between 20 and 40
    and length("whitelabel_share"."created_at") between 20 and 40);