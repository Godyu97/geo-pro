CREATE TABLE "intervention_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"status" text NOT NULL,
	"effective_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "intervention_batch_state_check" CHECK ("intervention_batch"."status" in ('pending', 'effective')
    and length("intervention_batch"."id") = 36
    and length("intervention_batch"."brand_id") = 36
    and length("intervention_batch"."owner_id") between 1 and 128
    and (
      ("intervention_batch"."status" = 'pending' and "intervention_batch"."effective_at" is null)
      or ("intervention_batch"."status" = 'effective' and "intervention_batch"."effective_at" is not null
        and length("intervention_batch"."effective_at") between 20 and 40)
    )
    and length("intervention_batch"."created_at") between 20 and 40
    and length("intervention_batch"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "intervention_batch_page" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"page_key" text NOT NULL,
	"verified_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "intervention_batch_page_state_check" CHECK (length("intervention_batch_page"."id") = 36
    and length("intervention_batch_page"."batch_id") = 36
    and length("intervention_batch_page"."brand_id") = 36
    and length("intervention_batch_page"."owner_id") between 1 and 128
    and length("intervention_batch_page"."page_key") between 1 and 300
    and ("intervention_batch_page"."verified_at" is null or length("intervention_batch_page"."verified_at") between 20 and 40)
    and length("intervention_batch_page"."created_at") between 20 and 40
    and length("intervention_batch_page"."updated_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "intervention_batch" ADD CONSTRAINT "intervention_batch_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_batch_page" ADD CONSTRAINT "intervention_batch_page_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_batch_page" ADD CONSTRAINT "intervention_batch_page_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intervention_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intervention_batch_owner_idx" ON "intervention_batch" USING btree ("owner_id","brand_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "intervention_batch_page_key_uidx" ON "intervention_batch_page" USING btree ("batch_id","page_key");