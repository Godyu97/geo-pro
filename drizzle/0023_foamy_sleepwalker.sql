CREATE TABLE "research_brief" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"question_cluster" text NOT NULL,
	"gap" text NOT NULL,
	"facts_json" text NOT NULL,
	"source_ids_json" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "research_brief_check" CHECK ("research_brief"."status" in ('proposed', 'accepted', 'dismissed')
    and length("research_brief"."question_cluster") between 1 and 200
    and length("research_brief"."gap") between 1 and 2000
    and length("research_brief"."facts_json") between 2 and 8000
    and length("research_brief"."source_ids_json") between 2 and 4000)
);
--> statement-breakpoint
ALTER TABLE "research_brief" ADD CONSTRAINT "research_brief_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_brief_brand_idx" ON "research_brief" USING btree ("brand_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "research_brief_owner_idx" ON "research_brief" USING btree ("owner_id","brand_id","created_at","id");