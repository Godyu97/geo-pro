CREATE TABLE "brand_fact_paste" (
	"brand_id" text NOT NULL,
	"id" text NOT NULL,
	"previous_id" text,
	"original" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "brand_fact_paste_brand_id_id_pk" PRIMARY KEY("brand_id","id"),
	CONSTRAINT "fact_paste_parent_check" CHECK ("brand_fact_paste"."previous_id" IS NULL OR "brand_fact_paste"."previous_id" <> "brand_fact_paste"."id")
);
--> statement-breakpoint
CREATE TABLE "brand_fact_use" (
	"brand_id" text NOT NULL,
	"fact_version_id" text NOT NULL,
	"content_version_id" text NOT NULL,
	"stage" text NOT NULL,
	CONSTRAINT "brand_fact_use_brand_id_fact_version_id_content_version_id_pk" PRIMARY KEY("brand_id","fact_version_id","content_version_id"),
	CONSTRAINT "fact_use_stage_check" CHECK ("brand_fact_use"."stage" IN ('review', 'delivery', 'published', 'history'))
);
--> statement-breakpoint
CREATE TABLE "brand_fact_version" (
	"brand_id" text NOT NULL,
	"id" text NOT NULL,
	"fact_id" text NOT NULL,
	"version" integer NOT NULL,
	"entity_version" integer NOT NULL,
	"paste_id" text,
	"revision" integer NOT NULL,
	"state" text NOT NULL,
	"content" text NOT NULL,
	"created_at" text NOT NULL,
	"confirmed_by" text,
	"confirmed_at" text,
	"revoked_at" text,
	CONSTRAINT "brand_fact_version_brand_id_id_pk" PRIMARY KEY("brand_id","id"),
	CONSTRAINT "fact_version_numbers_check" CHECK ("brand_fact_version"."version" > 0 AND "brand_fact_version"."revision" > 0),
	CONSTRAINT "fact_version_state_check" CHECK (
    ("brand_fact_version"."state" IN ('draft', 'pending_confirmation') AND "brand_fact_version"."confirmed_by" IS NULL AND "brand_fact_version"."confirmed_at" IS NULL AND "brand_fact_version"."revoked_at" IS NULL)
    OR ("brand_fact_version"."confirmed_by" IS NOT NULL AND "brand_fact_version"."confirmed_at" IS NOT NULL AND
      (("brand_fact_version"."state" = 'approved' AND "brand_fact_version"."revoked_at" IS NULL) OR ("brand_fact_version"."state" = 'revoked' AND "brand_fact_version"."revoked_at" IS NOT NULL))))
);
--> statement-breakpoint
ALTER TABLE "brand_fact_paste" ADD CONSTRAINT "brand_fact_paste_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_fact_paste" ADD CONSTRAINT "fact_paste_previous_fk" FOREIGN KEY ("brand_id","previous_id") REFERENCES "public"."brand_fact_paste"("brand_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_fact_use" ADD CONSTRAINT "fact_use_version_fk" FOREIGN KEY ("brand_id","fact_version_id") REFERENCES "public"."brand_fact_version"("brand_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_fact_version" ADD CONSTRAINT "fact_entity_version_fk" FOREIGN KEY ("brand_id","entity_version") REFERENCES "public"."brand_version"("brand_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_fact_version" ADD CONSTRAINT "fact_version_paste_fk" FOREIGN KEY ("brand_id","paste_id") REFERENCES "public"."brand_fact_paste"("brand_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_paste_previous_uidx" ON "brand_fact_paste" USING btree ("brand_id","previous_id");--> statement-breakpoint
CREATE INDEX "fact_paste_recent_idx" ON "brand_fact_paste" USING btree ("brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "fact_use_content_idx" ON "brand_fact_use" USING btree ("brand_id","content_version_id","fact_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_version_number_uidx" ON "brand_fact_version" USING btree ("brand_id","fact_id","version");--> statement-breakpoint
CREATE INDEX "fact_entity_version_idx" ON "brand_fact_version" USING btree ("brand_id","entity_version");--> statement-breakpoint
CREATE INDEX "fact_version_paste_idx" ON "brand_fact_version" USING btree ("brand_id","paste_id") WHERE "brand_fact_version"."paste_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fact_version_recent_idx" ON "brand_fact_version" USING btree ("brand_id","created_at","id");