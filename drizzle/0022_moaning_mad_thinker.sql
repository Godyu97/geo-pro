CREATE TABLE "source_inspection" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"citation_id" text NOT NULL,
	"state" text NOT NULL,
	"support" text NOT NULL,
	"page_live" integer NOT NULL,
	"readable" integer NOT NULL,
	"author_known" integer NOT NULL,
	"supports_brand" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "source_inspection_check" CHECK ("source_inspection"."state" in ('observed', 'resolved', 'limited', 'unknown')
    and "source_inspection"."support" in ('supports', 'unknown')
    and "source_inspection"."page_live" in (0, 1)
    and "source_inspection"."readable" in (0, 1)
    and "source_inspection"."author_known" in (0, 1)
    and "source_inspection"."supports_brand" in (0, 1)
    and ("source_inspection"."support" = 'unknown' or ("source_inspection"."page_live" = 1 and "source_inspection"."readable" = 1 and "source_inspection"."supports_brand" = 1)))
);
--> statement-breakpoint
ALTER TABLE "source_inspection" ADD CONSTRAINT "source_inspection_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_inspection" ADD CONSTRAINT "source_inspection_citation_id_answer_citation_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."answer_citation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_inspection_citation_uidx" ON "source_inspection" USING btree ("citation_id");--> statement-breakpoint
CREATE INDEX "source_inspection_brand_idx" ON "source_inspection" USING btree ("brand_id","citation_id");