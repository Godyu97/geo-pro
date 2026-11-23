CREATE TABLE "brand_retention_acceptance" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"policy_version" integer NOT NULL,
	"accepted_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_policy" (
	"version" integer PRIMARY KEY NOT NULL,
	"summary_zh" text NOT NULL,
	"summary_en" text NOT NULL,
	"recoverable_days" integer NOT NULL,
	"published_at" text NOT NULL,
	CONSTRAINT "retention_policy_version_check" CHECK ("retention_policy"."version" > 0),
	CONSTRAINT "retention_policy_days_check" CHECK ("retention_policy"."recoverable_days" between 1 and 3650),
	CONSTRAINT "retention_policy_summary_check" CHECK (length("retention_policy"."summary_zh") between 1 and 2000
    and length("retention_policy"."summary_en") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "brand_retention_acceptance" ADD CONSTRAINT "brand_retention_acceptance_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_retention_acceptance" ADD CONSTRAINT "brand_retention_acceptance_policy_version_retention_policy_version_fk" FOREIGN KEY ("policy_version") REFERENCES "public"."retention_policy"("version") ON DELETE no action ON UPDATE no action;