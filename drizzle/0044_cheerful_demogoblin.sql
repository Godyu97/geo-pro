CREATE TABLE "brand_member_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"role" text NOT NULL,
	"active" integer NOT NULL,
	"expires_at" text,
	"created_at" text NOT NULL,
	"revoked_at" text,
	CONSTRAINT "brand_member_grant_state_check" CHECK ("brand_member_grant"."role" in ('owner', 'member')
    and "brand_member_grant"."active" in (0, 1)
    and length("brand_member_grant"."user_id") between 1 and 128
    and length("brand_member_grant"."created_at") between 20 and 40
    and ("brand_member_grant"."expires_at" is null or length("brand_member_grant"."expires_at") between 20 and 40)
    and (("brand_member_grant"."active" = 1 and "brand_member_grant"."revoked_at" is null)
      or ("brand_member_grant"."active" = 0 and length("brand_member_grant"."revoked_at") between 20 and 40)))
);
--> statement-breakpoint
CREATE TABLE "queued_brand_action" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"status" text NOT NULL,
	"attachment" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "queued_brand_action_state_check" CHECK ("queued_brand_action"."status" in ('queued', 'stopped')
    and length("queued_brand_action"."attachment") between 16 and 64
    and length("queued_brand_action"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "brand_member_grant" ADD CONSTRAINT "brand_member_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_member_grant" ADD CONSTRAINT "brand_member_grant_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_brand_action" ADD CONSTRAINT "queued_brand_action_grant_id_brand_member_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."brand_member_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_member_grant_pair_uidx" ON "brand_member_grant" USING btree ("user_id","brand_id");--> statement-breakpoint
CREATE INDEX "brand_member_grant_user_idx" ON "brand_member_grant" USING btree ("user_id","brand_id") WHERE "brand_member_grant"."active" = 1;--> statement-breakpoint
CREATE INDEX "brand_member_grant_brand_idx" ON "brand_member_grant" USING btree ("brand_id","user_id");--> statement-breakpoint
CREATE INDEX "queued_brand_action_grant_idx" ON "queued_brand_action" USING btree ("grant_id","status");