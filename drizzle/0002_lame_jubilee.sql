CREATE TABLE "brand" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer NOT NULL,
	"entity_version" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "brand_status_check" CHECK ("brand"."status" in ('active', 'archived')),
	CONSTRAINT "brand_revision_check" CHECK ("brand"."entity_version" > 0 and "brand"."revision" >= "brand"."entity_version")
);
--> statement-breakpoint
CREATE TABLE "brand_draft" (
	"owner_id" text NOT NULL,
	"scope" text NOT NULL,
	"version" text NOT NULL,
	"base_revision" integer,
	"step" integer NOT NULL,
	"content" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "brand_draft_owner_id_scope_pk" PRIMARY KEY("owner_id","scope"),
	CONSTRAINT "brand_draft_step_check" CHECK ("brand_draft"."step" between 0 and 2),
	CONSTRAINT "brand_draft_scope_check" CHECK (("brand_draft"."scope" = 'new' and "brand_draft"."base_revision" is null) or ("brand_draft"."scope" <> 'new' and "brand_draft"."base_revision" is not null and "brand_draft"."base_revision" > 0))
);
--> statement-breakpoint
CREATE TABLE "brand_operation" (
	"owner_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"result" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "brand_operation_owner_id_operation_id_pk" PRIMARY KEY("owner_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "brand_version" (
	"brand_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "brand_version_brand_id_version_pk" PRIMARY KEY("brand_id","version"),
	CONSTRAINT "brand_version_number_check" CHECK ("brand_version"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_draft" ADD CONSTRAINT "brand_draft_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_operation" ADD CONSTRAINT "brand_operation_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_version" ADD CONSTRAINT "brand_version_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_active_owner_uidx" ON "brand" USING btree ("owner_id") WHERE "brand"."status" = 'active';--> statement-breakpoint
CREATE INDEX "brand_owner_status_created_idx" ON "brand" USING btree ("owner_id","status","created_at","id");