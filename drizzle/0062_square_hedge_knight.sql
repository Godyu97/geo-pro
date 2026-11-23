CREATE TABLE "brand_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"dispute_reason" text,
	"created_at" text NOT NULL,
	CONSTRAINT "brand_delivery_state_check" CHECK ("brand_delivery"."status" in ('pending', 'accepted', 'disputed')
    and (("brand_delivery"."status" = 'disputed' and "brand_delivery"."dispute_reason" is not null and length("brand_delivery"."dispute_reason") between 1 and 500)
      or ("brand_delivery"."status" in ('pending', 'accepted') and "brand_delivery"."dispute_reason" is null))
    and length("brand_delivery"."title") between 1 and 120
    and length("brand_delivery"."id") = 36
    and length("brand_delivery"."brand_id") = 36
    and length("brand_delivery"."owner_id") between 1 and 128
    and length("brand_delivery"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "brand_delivery" ADD CONSTRAINT "brand_delivery_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_delivery" ADD CONSTRAINT "brand_delivery_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_delivery_owner_idx" ON "brand_delivery" USING btree ("owner_id","created_at","id");