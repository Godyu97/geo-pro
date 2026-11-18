CREATE TABLE "quota_attempt" (
	"brand_id" text NOT NULL,
	"kind" text NOT NULL,
	"reservation_id" text NOT NULL,
	"id" text NOT NULL,
	"upper_minor" integer NOT NULL,
	"actual_minor" integer,
	"state" text NOT NULL,
	"started_at" text NOT NULL,
	"reconciled_at" text,
	CONSTRAINT "quota_attempt_brand_id_kind_reservation_id_id_pk" PRIMARY KEY("brand_id","kind","reservation_id","id"),
	CONSTRAINT "quota_attempt_cost_check" CHECK ("quota_attempt"."upper_minor" >= 0 and (
    ("quota_attempt"."state" in ('pending', 'unknown') and "quota_attempt"."actual_minor" is null and "quota_attempt"."reconciled_at" is null) or
    ("quota_attempt"."state" = 'known' and "quota_attempt"."actual_minor" is not null and "quota_attempt"."actual_minor" >= 0 and "quota_attempt"."reconciled_at" is not null)
  ))
);
--> statement-breakpoint
CREATE TABLE "quota_grant" (
	"brand_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"count_limit" integer NOT NULL,
	"budget_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"expires_at" text NOT NULL,
	"changed_at" text NOT NULL,
	"action" text NOT NULL,
	CONSTRAINT "quota_grant_brand_id_kind_version_pk" PRIMARY KEY("brand_id","kind","version"),
	CONSTRAINT "quota_grant_operation_unique" UNIQUE("brand_id","kind","operation_id"),
	CONSTRAINT "quota_grant_limits_check" CHECK ("quota_grant"."kind" in ('sampling', 'generation') and "quota_grant"."action" in ('set', 'revoke')
    and "quota_grant"."version" > 0 and "quota_grant"."count_limit" > 0 and "quota_grant"."budget_minor" >= 0 and length("quota_grant"."currency") = 3)
);
--> statement-breakpoint
CREATE TABLE "quota_reservation" (
	"brand_id" text NOT NULL,
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"grant_version" integer NOT NULL,
	"upper_minor" integer NOT NULL,
	"state" text NOT NULL,
	"created_at" text NOT NULL,
	"finalized_at" text,
	CONSTRAINT "quota_reservation_brand_id_kind_id_pk" PRIMARY KEY("brand_id","kind","id"),
	CONSTRAINT "quota_reservation_state_check" CHECK ("quota_reservation"."upper_minor" >= 0 and (
    ("quota_reservation"."state" = 'reserved' and "quota_reservation"."finalized_at" is null) or
    ("quota_reservation"."state" in ('settled', 'released') and "quota_reservation"."finalized_at" is not null)
  ))
);
--> statement-breakpoint
ALTER TABLE "quota_attempt" ADD CONSTRAINT "quota_attempt_reservation_fk" FOREIGN KEY ("brand_id","kind","reservation_id") REFERENCES "public"."quota_reservation"("brand_id","kind","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_grant" ADD CONSTRAINT "quota_grant_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservation" ADD CONSTRAINT "quota_reservation_grant_fk" FOREIGN KEY ("brand_id","kind","grant_version") REFERENCES "public"."quota_grant"("brand_id","kind","version") ON DELETE cascade ON UPDATE no action;