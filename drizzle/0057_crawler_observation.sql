CREATE TABLE "crawler_observation" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"identity" text NOT NULL,
	"citations" integer NOT NULL,
	"called_included" integer NOT NULL,
	"observed_at" text NOT NULL,
	CONSTRAINT "crawler_observation_state_check" CHECK ("crawler_observation"."identity" in ('unverified', 'verified')
    and "crawler_observation"."citations" between 0 and 1000000000
    and "crawler_observation"."called_included" = 0
    and length("crawler_observation"."id") = 36
    and length("crawler_observation"."brand_id") = 36
    and length("crawler_observation"."owner_id") between 1 and 128
    and length("crawler_observation"."observed_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "crawler_observation" ADD CONSTRAINT "crawler_observation_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawler_observation" ADD CONSTRAINT "crawler_observation_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawler_observation_owner_idx" ON "crawler_observation" USING btree ("owner_id","observed_at","id");