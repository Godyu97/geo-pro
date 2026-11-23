CREATE TABLE "formal_confounder" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"factor" text NOT NULL,
	"note" text NOT NULL,
	"recorded_at" text NOT NULL,
	CONSTRAINT "formal_confounder_state_check" CHECK ("formal_confounder"."factor" in ('model', 'marketing', 'price')
    and length(trim("formal_confounder"."note")) between 1 and 400
    and length("formal_confounder"."owner_id") between 1 and 128
    and length("formal_confounder"."recorded_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "formal_confounder" ADD CONSTRAINT "formal_confounder_observation_id_formal_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."formal_observation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formal_confounder" ADD CONSTRAINT "formal_confounder_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "formal_confounder_observation_idx" ON "formal_confounder" USING btree ("owner_id","observation_id","recorded_at","id");