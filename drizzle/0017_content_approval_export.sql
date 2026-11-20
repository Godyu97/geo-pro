CREATE TABLE "content_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"content_version_id" text NOT NULL,
	"content_fingerprint" text NOT NULL,
	"fact_version_ids_json" text NOT NULL,
	"decision" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "content_approval_state_check" CHECK ("content_approval"."decision" in ('approved', 'rejected')
    and length("content_approval"."content_fingerprint") > 0
    and length("content_approval"."fact_version_ids_json") > 1)
);
--> statement-breakpoint
CREATE TABLE "content_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"rights_statement" text NOT NULL,
	"visibility" text NOT NULL,
	"review_status" text NOT NULL,
	"content_ref" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "content_asset_state_check" CHECK ("content_asset"."kind" in ('cover', 'inline', 'other')
    and "content_asset"."visibility" in ('public', 'internal')
    and "content_asset"."review_status" in ('pending', 'approved', 'rejected')
    and length("content_asset"."content_ref") > 0
    and length("content_asset"."fingerprint") > 0)
);
--> statement-breakpoint
CREATE TABLE "content_delivery_package" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"content_version_id" text NOT NULL,
	"approval_id" text,
	"target_channel" text NOT NULL,
	"kind" text NOT NULL,
	"content_fingerprint" text NOT NULL,
	"fact_version_ids_json" text NOT NULL,
	"labeling_profile_version" text NOT NULL,
	"do_not_reuse" integer DEFAULT 0 NOT NULL,
	"non_publishable" integer DEFAULT 0 NOT NULL,
	"manifest_json" text NOT NULL,
	"files_json" text NOT NULL,
	"package_fingerprint" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "content_delivery_package_state_check" CHECK ("content_delivery_package"."kind" in ('formal', 'review')
    and "content_delivery_package"."do_not_reuse" in (0, 1)
    and "content_delivery_package"."non_publishable" in (0, 1)
    and ("content_delivery_package"."kind" = 'review' or ("content_delivery_package"."non_publishable" = 0 and "content_delivery_package"."approval_id" is not null))
    and length("content_delivery_package"."manifest_json") > 1
    and length("content_delivery_package"."files_json") > 1
    and length("content_delivery_package"."package_fingerprint") > 0)
);
--> statement-breakpoint
CREATE TABLE "content_export_job" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"status" text NOT NULL,
	"selection_json" text NOT NULL,
	"preflight_json" text NOT NULL,
	"chosen_subset_json" text NOT NULL,
	"result_package_ids_json" text NOT NULL,
	"error" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "content_export_job_state_check" CHECK ("content_export_job"."status" in ('queued', 'ready', 'failed')
    and length("content_export_job"."selection_json") > 1
    and length("content_export_job"."preflight_json") > 1
    and length("content_export_job"."chosen_subset_json") > 1
    and length("content_export_job"."result_package_ids_json") > 1)
);
--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_state_check";--> statement-breakpoint
ALTER TABLE "content_version" ADD COLUMN "target_channel" text DEFAULT 'primary_page' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_version" ADD COLUMN "labeling_profile_version" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_version" ADD COLUMN "labeling_profile_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_version" ADD COLUMN "image_asset_ids_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_version" ADD COLUMN "fact_version_ids_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_version" ADD COLUMN "updated_at" text;--> statement-breakpoint
UPDATE "content_version" SET "updated_at" = "created_at";--> statement-breakpoint
UPDATE "content_version" SET "fact_version_ids_json" = (SELECT "fact_version_ids_json" FROM "content_brief_version" WHERE "content_brief_version"."id" = "content_version"."brief_version_id");--> statement-breakpoint
ALTER TABLE "content_version" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "content_approval" ADD CONSTRAINT "content_approval_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_approval" ADD CONSTRAINT "content_approval_version_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset" ADD CONSTRAINT "content_asset_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_delivery_package" ADD CONSTRAINT "content_delivery_package_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_delivery_package" ADD CONSTRAINT "content_delivery_package_version_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_delivery_package" ADD CONSTRAINT "content_delivery_package_approval_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."content_approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_export_job" ADD CONSTRAINT "content_export_job_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_approval_version_idx" ON "content_approval" USING btree ("content_version_id","created_at","id");--> statement-breakpoint
CREATE INDEX "content_approval_brand_idx" ON "content_approval" USING btree ("brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "content_asset_brand_idx" ON "content_asset" USING btree ("brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "content_asset_owner_idx" ON "content_asset" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "content_delivery_package_version_idx" ON "content_delivery_package" USING btree ("content_version_id","created_at","id");--> statement-breakpoint
CREATE INDEX "content_delivery_package_brand_idx" ON "content_delivery_package" USING btree ("brand_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_export_job_operation_uidx" ON "content_export_job" USING btree ("brand_id","operation_id");--> statement-breakpoint
CREATE INDEX "content_export_job_owner_idx" ON "content_export_job" USING btree ("owner_id","updated_at","id");--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_state_check" CHECK ("content_version"."status" in ('draft', 'in_review', 'approved', 'rejected', 'invalidated')
    and "content_version"."labeling_profile_status" in ('verified', 'unverified')
    and length("content_version"."target_channel") > 0
    and length("content_version"."labeling_profile_version") > 0
    and length("content_version"."image_asset_ids_json") > 1
    and length("content_version"."fact_version_ids_json") > 1
    and "content_version"."template_kind" in ('fact_faq', 'scenario_solution', 'verifiable_comparison')
    and length("content_version"."title") > 0
    and length("content_version"."body_markdown") > 0
    and length("content_version"."claims_json") > 1
    and length("content_version"."fingerprint") > 0);