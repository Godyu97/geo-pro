CREATE TABLE "lead_observation" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"identified_referrals" integer NOT NULL,
	"session_denominator" integer,
	"self_reported" integer NOT NULL,
	"crawler_visits" integer NOT NULL,
	"answer_citations" integer NOT NULL,
	"called_included" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "lead_observation_state_check" CHECK ("lead_observation"."identified_referrals" between 0 and 1000000000
    and ("lead_observation"."session_denominator" is null or "lead_observation"."session_denominator" between 0 and 1000000000)
    and "lead_observation"."self_reported" between 0 and 1000000000
    and "lead_observation"."crawler_visits" between 0 and 1000000000
    and "lead_observation"."answer_citations" between 0 and 1000000000
    and "lead_observation"."called_included" = 0
    and length("lead_observation"."owner_id") between 1 and 128
    and length("lead_observation"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "lead_qualification" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"status" text NOT NULL,
	"real_need" integer NOT NULL,
	"target_industry" integer NOT NULL,
	"follow_up" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "lead_qualification_state_check" CHECK ("lead_qualification"."status" in ('unfrozen', 'qualified', 'disqualified')
    and "lead_qualification"."rule_version" between 1 and 10000
    and "lead_qualification"."real_need" in (0, 1)
    and "lead_qualification"."target_industry" in (0, 1)
    and "lead_qualification"."follow_up" in (0, 1)
    and length("lead_qualification"."owner_id") between 1 and 128
    and length("lead_qualification"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "lead_validity_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"version" integer NOT NULL,
	"frozen" integer NOT NULL,
	"requires_real_need" integer NOT NULL,
	"requires_industry" integer NOT NULL,
	"requires_follow_up" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "lead_validity_rule_state_check" CHECK ("lead_validity_rule"."version" between 1 and 10000
    and "lead_validity_rule"."frozen" in (0, 1)
    and "lead_validity_rule"."requires_real_need" in (0, 1)
    and "lead_validity_rule"."requires_industry" in (0, 1)
    and "lead_validity_rule"."requires_follow_up" in (0, 1)
    and length("lead_validity_rule"."owner_id") between 1 and 128
    and length("lead_validity_rule"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "lead_observation" ADD CONSTRAINT "lead_observation_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualification" ADD CONSTRAINT "lead_qualification_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualification" ADD CONSTRAINT "lead_qualification_rule_id_lead_validity_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."lead_validity_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_validity_rule" ADD CONSTRAINT "lead_validity_rule_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_observation_owner_idx" ON "lead_observation" USING btree ("owner_id","brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "lead_qualification_owner_idx" ON "lead_qualification" USING btree ("owner_id","brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "lead_qualification_status_idx" ON "lead_qualification" USING btree ("owner_id","brand_id","status");--> statement-breakpoint
CREATE INDEX "lead_qualification_rule_idx" ON "lead_qualification" USING btree ("rule_id","rule_version");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_validity_rule_version_uidx" ON "lead_validity_rule" USING btree ("brand_id","version");--> statement-breakpoint
CREATE INDEX "lead_validity_rule_owner_idx" ON "lead_validity_rule" USING btree ("owner_id","brand_id","version","id");