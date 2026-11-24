CREATE TABLE "source_original_fragment" (
	"id" text PRIMARY KEY NOT NULL,
	"source_original_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"page" integer,
	"excerpt" text,
	"candidate_state" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "source_original_fragment_state_check" CHECK ("source_original_fragment"."candidate_state" = 'unapproved'
    and "source_original_fragment"."ordinal" between 0 and 199
    and ("source_original_fragment"."page" is null or "source_original_fragment"."page" between 1 and 100000)
    and ("source_original_fragment"."excerpt" is null or length("source_original_fragment"."excerpt") between 1 and 50000)
    and length("source_original_fragment"."id") = 36
    and length("source_original_fragment"."source_original_id") = 36
    and length("source_original_fragment"."brand_id") = 36
    and length("source_original_fragment"."owner_id") between 1 and 128
    and length("source_original_fragment"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "source_original_fragment_conflict" (
	"fragment_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"fact_version_id" text NOT NULL,
	"fact_version" integer NOT NULL,
	CONSTRAINT "source_original_fragment_conflict_state_check" CHECK ("source_original_fragment_conflict"."fact_version" > 0
    and length("source_original_fragment_conflict"."fragment_id") = 36
    and length("source_original_fragment_conflict"."brand_id") = 36
    and length("source_original_fragment_conflict"."fact_version_id") = 36)
);
--> statement-breakpoint
ALTER TABLE "source_original_fragment" ADD CONSTRAINT "source_original_fragment_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_original_fragment" ADD CONSTRAINT "source_original_fragment_source_fk" FOREIGN KEY ("source_original_id") REFERENCES "public"."source_original"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_original_fragment_conflict" ADD CONSTRAINT "source_original_fragment_conflict_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_original_fragment_conflict" ADD CONSTRAINT "source_original_fragment_conflict_fragment_fk" FOREIGN KEY ("fragment_id") REFERENCES "public"."source_original_fragment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_original_fragment_conflict" ADD CONSTRAINT "source_original_fragment_conflict_fact_fk" FOREIGN KEY ("brand_id","fact_version_id") REFERENCES "public"."brand_fact_version"("brand_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_original_fragment_ordinal_uidx" ON "source_original_fragment" USING btree ("source_original_id","ordinal");--> statement-breakpoint
CREATE INDEX "source_original_fragment_brand_idx" ON "source_original_fragment" USING btree ("brand_id","source_original_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "source_original_fragment_conflict_uidx" ON "source_original_fragment_conflict" USING btree ("fragment_id","fact_version_id");--> statement-breakpoint
CREATE INDEX "source_original_fragment_conflict_brand_idx" ON "source_original_fragment_conflict" USING btree ("brand_id","fragment_id","fact_version","fact_version_id");