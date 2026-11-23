CREATE TABLE "brand_owner_transfer" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "brand_owner_transfer_state_check" CHECK ("brand_owner_transfer"."from_user_id" <> "brand_owner_transfer"."to_user_id"
    and length("brand_owner_transfer"."from_user_id") between 1 and 128
    and length("brand_owner_transfer"."to_user_id") between 1 and 128
    and length("brand_owner_transfer"."actor_id") between 1 and 128
    and length("brand_owner_transfer"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "brand_owner_transfer" ADD CONSTRAINT "brand_owner_transfer_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_owner_transfer" ADD CONSTRAINT "brand_owner_transfer_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_owner_transfer" ADD CONSTRAINT "brand_owner_transfer_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_owner_transfer" ADD CONSTRAINT "brand_owner_transfer_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_owner_transfer_brand_idx" ON "brand_owner_transfer" USING btree ("brand_id","created_at","id");