CREATE TABLE "notification_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"sent" integer NOT NULL,
	"body_has_customer_text" integer NOT NULL,
	"body_hash" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "notification_delivery_state_check" CHECK ("notification_delivery"."sent" in (0, 1)
    and "notification_delivery"."body_has_customer_text" in (0, 1)
    and ("notification_delivery"."body_has_customer_text" = 0 or "notification_delivery"."sent" = 0)
    and length("notification_delivery"."id") = 36
    and length("notification_delivery"."endpoint_id") = 36
    and length("notification_delivery"."brand_id") = 36
    and length("notification_delivery"."owner_id") between 1 and 128
    and length("notification_delivery"."body_hash") = 64
    and "notification_delivery"."body_hash" = lower("notification_delivery"."body_hash")
    and "notification_delivery"."body_hash" ~ '^[0-9a-f]{64}$'
    and length("notification_delivery"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "notification_endpoint" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"label" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "notification_endpoint_state_check" CHECK ("notification_endpoint"."status" in ('verified', 'revoked')
    and length("notification_endpoint"."id") = 36
    and length("notification_endpoint"."brand_id") = 36
    and length("notification_endpoint"."owner_id") between 1 and 128
    and length("notification_endpoint"."label") between 1 and 80
    and length("notification_endpoint"."created_at") between 20 and 40
    and length("notification_endpoint"."updated_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_endpoint_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."notification_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_endpoint" ADD CONSTRAINT "notification_endpoint_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_delivery_endpoint_idx" ON "notification_delivery" USING btree ("owner_id","endpoint_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notification_endpoint_owner_idx" ON "notification_endpoint" USING btree ("owner_id","brand_id","created_at","id");