CREATE TABLE "image_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"version" integer NOT NULL,
	"rights_status" text NOT NULL,
	"file_name" text NOT NULL,
	"byte_size" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "image_asset_state_check" CHECK ("image_asset"."rights_status" in ('active', 'revoked', 'expired')
    and "image_asset"."version" >= 1
    and length("image_asset"."id") = 36
    and length("image_asset"."brand_id") = 36
    and length("image_asset"."owner_id") between 1 and 128
    and length("image_asset"."file_name") between 1 and 120
    and "image_asset"."file_name" not like '%/%'
    and "image_asset"."file_name" not like '%..%'
    and ("image_asset"."byte_size" is null or "image_asset"."byte_size" between 0 and 2147483647)
    and length("image_asset"."created_at") between 20 and 40
    and length("image_asset"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "image_asset_todo" (
	"id" text PRIMARY KEY NOT NULL,
	"use_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"content_version_id" text NOT NULL,
	"asset_version" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "image_asset_todo_state_check" CHECK ("image_asset_todo"."asset_version" >= 1
    and length("image_asset_todo"."id") = 36
    and length("image_asset_todo"."use_id") = 36
    and length("image_asset_todo"."asset_id") = 36
    and length("image_asset_todo"."brand_id") = 36
    and length("image_asset_todo"."content_version_id") = 36
    and length("image_asset_todo"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "image_asset_use" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"content_version_id" text NOT NULL,
	"asset_version" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "image_asset_use_state_check" CHECK ("image_asset_use"."asset_version" >= 1
    and length("image_asset_use"."id") = 36
    and length("image_asset_use"."asset_id") = 36
    and length("image_asset_use"."brand_id") = 36
    and length("image_asset_use"."content_version_id") = 36
    and length("image_asset_use"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "image_asset" ADD CONSTRAINT "image_asset_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_asset_todo" ADD CONSTRAINT "image_asset_todo_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_asset_todo" ADD CONSTRAINT "image_asset_todo_asset_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."image_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_asset_use" ADD CONSTRAINT "image_asset_use_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_asset_use" ADD CONSTRAINT "image_asset_use_asset_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."image_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_asset_owner_idx" ON "image_asset" USING btree ("owner_id","brand_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "image_asset_todo_use_uidx" ON "image_asset_todo" USING btree ("use_id");--> statement-breakpoint
CREATE INDEX "image_asset_todo_asset_idx" ON "image_asset_todo" USING btree ("asset_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "image_asset_use_pair_uidx" ON "image_asset_use" USING btree ("asset_id","content_version_id");--> statement-breakpoint
CREATE INDEX "image_asset_use_asset_idx" ON "image_asset_use" USING btree ("asset_id","created_at","id");