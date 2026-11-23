CREATE TABLE "channel_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"channel_key" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "channel_profile_state_check" CHECK (length("channel_profile"."channel_key") between 1 and 64
    and length("channel_profile"."created_at") between 20 and 40
    and length("channel_profile"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "channel_profile_version" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"channel_key" text NOT NULL,
	"max_characters" integer,
	"note" text NOT NULL,
	"version_number" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "channel_profile_version_state_check" CHECK (length("channel_profile_version"."channel_key") between 1 and 64
    and ("channel_profile_version"."max_characters" is null or "channel_profile_version"."max_characters" between 1 and 1000000)
    and length("channel_profile_version"."note") between 1 and 2000
    and "channel_profile_version"."version_number" between 1 and 1000000
    and length("channel_profile_version"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "content_channel_variant" ADD COLUMN "channel_profile_version_id" text;--> statement-breakpoint
ALTER TABLE "channel_profile" ADD CONSTRAINT "channel_profile_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_profile_version" ADD CONSTRAINT "channel_profile_version_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_profile_version" ADD CONSTRAINT "channel_profile_version_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."channel_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_profile_brand_channel_uidx" ON "channel_profile" USING btree ("brand_id","channel_key");--> statement-breakpoint
CREATE INDEX "channel_profile_owner_idx" ON "channel_profile" USING btree ("owner_id","brand_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_profile_version_number_uidx" ON "channel_profile_version" USING btree ("profile_id","version_number");--> statement-breakpoint
CREATE INDEX "channel_profile_version_owner_idx" ON "channel_profile_version" USING btree ("owner_id","brand_id","channel_key","version_number","id");--> statement-breakpoint
ALTER TABLE "content_channel_variant" ADD CONSTRAINT "content_channel_variant_profile_fk" FOREIGN KEY ("channel_profile_version_id") REFERENCES "public"."channel_profile_version"("id") ON DELETE restrict ON UPDATE no action;