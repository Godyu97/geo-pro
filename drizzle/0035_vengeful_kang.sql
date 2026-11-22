CREATE TABLE "entity_review" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"analysis_version_id" text NOT NULL,
	"confirmed_error" integer NOT NULL,
	"reviewed" integer NOT NULL,
	"population_count" integer NOT NULL,
	"method" text NOT NULL,
	"fact" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "entity_review_state_check" CHECK ("entity_review"."confirmed_error" in (0, 1)
    and "entity_review"."reviewed" in (0, 1)
    and "entity_review"."fact" in ('active', 'expired', 'conflict')
    and ("entity_review"."confirmed_error" = 0 or ("entity_review"."reviewed" = 1 and "entity_review"."fact" = 'active'))
    and "entity_review"."population_count" between 1 and 100000
    and length("entity_review"."method") between 1 and 200
    and length("entity_review"."owner_id") between 1 and 128
    and length("entity_review"."observation_id") = 36
    and length("entity_review"."analysis_version_id") = 36
    and length("entity_review"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "entity_review" ADD CONSTRAINT "entity_review_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_review_sample_uidx" ON "entity_review" USING btree ("observation_id","analysis_version_id","created_at");--> statement-breakpoint
CREATE INDEX "entity_review_owner_idx" ON "entity_review" USING btree ("owner_id","brand_id","observation_id","analysis_version_id","created_at","id");