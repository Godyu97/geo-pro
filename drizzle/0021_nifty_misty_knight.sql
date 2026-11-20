CREATE TABLE "competitor_mention" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"set_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"competitor_label" text NOT NULL,
	"ordered" integer NOT NULL,
	"position" integer,
	"created_at" text NOT NULL,
	CONSTRAINT "competitor_mention_check" CHECK ("competitor_mention"."ordered" in (0, 1)
    and length("competitor_mention"."competitor_label") between 1 and 80
    and (
      ("competitor_mention"."ordered" = 1 and "competitor_mention"."position" > 0)
      or ("competitor_mention"."ordered" = 0 and "competitor_mention"."position" is null)
    ))
);
--> statement-breakpoint
CREATE TABLE "competitor_set" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"version" integer NOT NULL,
	"labels_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "competitor_set_check" CHECK ("competitor_set"."version" > 0 and length("competitor_set"."labels_json") between 2 and 2000)
);
--> statement-breakpoint
ALTER TABLE "competitor_mention" ADD CONSTRAINT "competitor_mention_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_mention" ADD CONSTRAINT "competitor_mention_set_id_competitor_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."competitor_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_mention" ADD CONSTRAINT "competitor_mention_observation_id_answer_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."answer_observation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_set" ADD CONSTRAINT "competitor_set_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_mention_once_uidx" ON "competitor_mention" USING btree ("set_id","observation_id","competitor_label");--> statement-breakpoint
CREATE INDEX "competitor_mention_set_idx" ON "competitor_mention" USING btree ("brand_id","set_id","observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_set_brand_version_uidx" ON "competitor_set" USING btree ("brand_id","version");--> statement-breakpoint
CREATE INDEX "competitor_set_owner_idx" ON "competitor_set" USING btree ("owner_id","brand_id","version");