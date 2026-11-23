CREATE TABLE "formal_control_page" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"page_key" text NOT NULL,
	"label" text NOT NULL,
	"registered_at" text NOT NULL,
	CONSTRAINT "formal_control_page_state_check" CHECK ("formal_control_page"."label" = 'observation'
    and length(trim("formal_control_page"."page_key")) between 1 and 300
    and length("formal_control_page"."owner_id") between 1 and 128
    and length("formal_control_page"."registered_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "formal_control_page" ADD CONSTRAINT "formal_control_page_observation_id_formal_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."formal_observation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formal_control_page" ADD CONSTRAINT "formal_control_page_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "formal_control_page_page_uidx" ON "formal_control_page" USING btree ("observation_id","page_key");--> statement-breakpoint
CREATE INDEX "formal_control_page_observation_idx" ON "formal_control_page" USING btree ("owner_id","observation_id","registered_at","id");