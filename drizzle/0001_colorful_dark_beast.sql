CREATE TABLE "maintenance_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"subject_id" text,
	"permission" text,
	"action" text NOT NULL,
	"result" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" text NOT NULL,
	CONSTRAINT "maintenance_audit_result_check" CHECK ("maintenance_audit"."result" in ('allowed', 'denied', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "maintenance_grant" (
	"user_id" text NOT NULL,
	"permission" text NOT NULL,
	"granted_at" text NOT NULL,
	"revoked_at" text,
	"operator_id" text NOT NULL,
	CONSTRAINT "maintenance_grant_user_id_permission_pk" PRIMARY KEY("user_id","permission"),
	CONSTRAINT "maintenance_grant_permission_check" CHECK ("maintenance_grant"."permission" in ('capabilities.manage', 'quotas.manage', 'support.read'))
);
--> statement-breakpoint
ALTER TABLE "maintenance_grant" ADD CONSTRAINT "maintenance_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_audit_actor_time_idx" ON "maintenance_audit" USING btree ("actor_id","occurred_at","id");