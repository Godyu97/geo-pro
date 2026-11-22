CREATE TABLE "approval_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"version_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "approval_attempt_state_check" CHECK ("approval_attempt"."kind" in ('fact', 'content')
    and "approval_attempt"."reason" in ('separation', 'duty')
    and length("approval_attempt"."version_id") = 36
    and length("approval_attempt"."actor_id") between 1 and 128
    and length("approval_attempt"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "approval_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"version" integer NOT NULL,
	"dual_control" integer NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "approval_policy_state_check" CHECK ("approval_policy"."version" > 0
    and "approval_policy"."dual_control" in (0, 1)
    and length("approval_policy"."updated_by") between 1 and 128
    and length("approval_policy"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "brand_approval_duty" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"user_id" text NOT NULL,
	"fact_approver" integer NOT NULL,
	"content_approver" integer NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "brand_approval_duty_state_check" CHECK ("brand_approval_duty"."fact_approver" in (0, 1)
    and "brand_approval_duty"."content_approver" in (0, 1)
    and ("brand_approval_duty"."fact_approver" = 1 or "brand_approval_duty"."content_approver" = 1)
    and length("brand_approval_duty"."user_id") between 1 and 128
    and length("brand_approval_duty"."updated_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "approval_attempt" ADD CONSTRAINT "approval_attempt_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy" ADD CONSTRAINT "approval_policy_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_approval_duty" ADD CONSTRAINT "brand_approval_duty_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_approval_duty" ADD CONSTRAINT "brand_approval_duty_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_attempt_version_idx" ON "approval_attempt" USING btree ("brand_id","version_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_policy_brand_uidx" ON "approval_policy" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_approval_duty_pair_uidx" ON "brand_approval_duty" USING btree ("brand_id","user_id");--> statement-breakpoint
CREATE INDEX "brand_approval_duty_user_idx" ON "brand_approval_duty" USING btree ("user_id","brand_id");