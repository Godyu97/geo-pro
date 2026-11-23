CREATE TABLE "whitelabel_share" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"track" text NOT NULL,
	"sample_size" integer NOT NULL,
	"grade" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "whitelabel_share_state_check" CHECK ("whitelabel_share"."revoked" in (0, 1)
    and "whitelabel_share"."sample_size" between 0 and 2000000000
    and "whitelabel_share"."track" ~ '^[a-z0-9_]{1,64}$'
    and "whitelabel_share"."grade" ~ '^[a-z0-9_]{1,32}$'
    and length("whitelabel_share"."id") = 36
    and length("whitelabel_share"."brand_id") = 36
    and length("whitelabel_share"."owner_id") between 1 and 128
    and length("whitelabel_share"."expires_at") between 20 and 40
    and length("whitelabel_share"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "whitelabel_share_access" (
	"id" text PRIMARY KEY NOT NULL,
	"share_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"accessed_at" text NOT NULL,
	CONSTRAINT "whitelabel_share_access_state_check" CHECK (length("whitelabel_share_access"."id") = 36
    and length("whitelabel_share_access"."share_id") = 36
    and length("whitelabel_share_access"."visitor_id") between 1 and 128
    and length("whitelabel_share_access"."accessed_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "whitelabel_share" ADD CONSTRAINT "whitelabel_share_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_share" ADD CONSTRAINT "whitelabel_share_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_share_access" ADD CONSTRAINT "whitelabel_share_access_share_id_whitelabel_share_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."whitelabel_share"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whitelabel_share_access" ADD CONSTRAINT "whitelabel_share_access_visitor_id_user_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whitelabel_share_owner_idx" ON "whitelabel_share" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "whitelabel_share_access_share_idx" ON "whitelabel_share_access" USING btree ("share_id","accessed_at","id");