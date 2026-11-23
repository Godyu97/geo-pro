CREATE TABLE "entitlement_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"entitlement_id" text NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "entitlement_usage_state_check" CHECK ("entitlement_usage"."kind" in ('monitoring', 'content', 'labor')
    and "entitlement_usage"."quantity" between 1 and 1000000
    and length("entitlement_usage"."id") = 36
    and length("entitlement_usage"."entitlement_id") = 36
    and length("entitlement_usage"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "service_entitlement" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"monitoring_quota" integer NOT NULL,
	"content_quota" integer NOT NULL,
	"labor_quota" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "service_entitlement_state_check" CHECK ("service_entitlement"."kind" in ('trial', 'quote')
    and "service_entitlement"."version" between 1 and 1000000
    and "service_entitlement"."monitoring_quota" between 0 and 1000000
    and "service_entitlement"."content_quota" between 0 and 1000000
    and "service_entitlement"."labor_quota" between 0 and 1000000
    and length("service_entitlement"."id") = 36
    and length("service_entitlement"."brand_id") = 36
    and length("service_entitlement"."owner_id") between 1 and 128
    and length("service_entitlement"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "entitlement_usage" ADD CONSTRAINT "entitlement_usage_entitlement_id_service_entitlement_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."service_entitlement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_entitlement" ADD CONSTRAINT "service_entitlement_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_entitlement" ADD CONSTRAINT "service_entitlement_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlement_usage_entitlement_idx" ON "entitlement_usage" USING btree ("entitlement_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_entitlement_brand_kind_version_uidx" ON "service_entitlement" USING btree ("brand_id","kind","version");--> statement-breakpoint
CREATE INDEX "service_entitlement_owner_idx" ON "service_entitlement" USING btree ("owner_id","created_at","id");