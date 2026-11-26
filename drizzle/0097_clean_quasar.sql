CREATE TABLE "brand_group" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "brand_group_state_check" CHECK (length("brand_group"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "platform_account_role" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "platform_account_role_state_check" CHECK ("platform_account_role"."role" in ('admin', 'user')
    and length("platform_account_role"."user_id") between 1 and 128
    and length("platform_account_role"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "platform_role_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"subject_id" text,
	"role" text,
	"action" text NOT NULL,
	"result" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" text NOT NULL,
	CONSTRAINT "platform_role_audit_state_check" CHECK ("platform_role_audit"."action" in ('grant', 'revoke')
    and "platform_role_audit"."result" in ('allowed', 'denied', 'failed')
    and ("platform_role_audit"."role" is null or "platform_role_audit"."role" in ('admin', 'user'))
    and length("platform_role_audit"."occurred_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "team_group" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "team_group_state_check" CHECK ("team_group"."kind" in ('personal', 'team')
    and length("team_group"."owner_user_id") between 1 and 128
    and length("team_group"."name") between 1 and 120
    and length("team_group"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "team_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"active" integer NOT NULL,
	"created_at" text NOT NULL,
	"revoked_at" text,
	CONSTRAINT "team_group_member_state_check" CHECK ("team_group_member"."active" in (0, 1)
    and length("team_group_member"."user_id") between 1 and 128
    and length("team_group_member"."created_at") between 20 and 40
    and (("team_group_member"."active" = 1 and "team_group_member"."revoked_at" is null)
      or ("team_group_member"."active" = 0 and length("team_group_member"."revoked_at") between 20 and 40)))
);
--> statement-breakpoint
ALTER TABLE "team_invitation" DROP CONSTRAINT "team_invitation_state_check";--> statement-breakpoint
ALTER TABLE "brand_group" ADD CONSTRAINT "brand_group_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_group" ADD CONSTRAINT "brand_group_group_id_team_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."team_group"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_account_role" ADD CONSTRAINT "platform_account_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_group" ADD CONSTRAINT "team_group_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_group_member" ADD CONSTRAINT "team_group_member_group_id_team_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."team_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_group_member" ADD CONSTRAINT "team_group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_group_group_idx" ON "brand_group" USING btree ("group_id","brand_id");--> statement-breakpoint
CREATE INDEX "platform_role_audit_actor_time_idx" ON "platform_role_audit" USING btree ("actor_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_group_personal_uidx" ON "team_group" USING btree ("owner_user_id") WHERE "team_group"."kind" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "team_group_member_pair_uidx" ON "team_group_member" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "team_group_member_user_idx" ON "team_group_member" USING btree ("user_id","group_id") WHERE "team_group_member"."active" = 1;--> statement-breakpoint
ALTER TABLE "team_invitation" ADD CONSTRAINT "team_invitation_state_check" CHECK ("team_invitation"."role" in ('member', 'read_only')
    and "team_invitation"."status" in ('open', 'accepted', 'expired', 'revoked')
    and "team_invitation"."invitee_user_id" <> "team_invitation"."created_by"
    and length("team_invitation"."invitee_user_id") between 1 and 128
    and length("team_invitation"."created_by") between 1 and 128
    and length("team_invitation"."token_hash") = 64
    and "team_invitation"."token_hash" = lower("team_invitation"."token_hash")
    and length("team_invitation"."expires_at") between 20 and 40
    and length("team_invitation"."created_at") between 20 and 40
    and (("team_invitation"."status" in ('open', 'accepted', 'revoked') and "team_invitation"."replaced_by" is null)
      or ("team_invitation"."status" = 'expired' and ("team_invitation"."replaced_by" is null or length("team_invitation"."replaced_by") between 1 and 128))));--> statement-breakpoint
INSERT INTO "platform_account_role" ("user_id", "role", "updated_at")
SELECT u."id", 'user', '2026-11-26T00:00:00.000Z'
FROM "user" u
WHERE NOT EXISTS (
  SELECT 1 FROM "platform_account_role" r WHERE r."user_id" = u."id"
);--> statement-breakpoint
INSERT INTO "team_group" ("id", "owner_user_id", "kind", "name", "created_at")
SELECT gen_random_uuid()::text, u."id", 'personal',
  CASE WHEN length(trim(u."name")) BETWEEN 1 AND 120 THEN trim(u."name") ELSE 'Personal' END,
  '2026-11-26T00:00:00.000Z'
FROM "user" u
WHERE NOT EXISTS (
  SELECT 1 FROM "team_group" g WHERE g."owner_user_id" = u."id" AND g."kind" = 'personal'
);--> statement-breakpoint
INSERT INTO "team_group_member" ("id", "group_id", "user_id", "active", "created_at", "revoked_at")
SELECT gen_random_uuid()::text, g."id", g."owner_user_id", 1, g."created_at", NULL
FROM "team_group" g
WHERE g."kind" = 'personal'
  AND NOT EXISTS (
    SELECT 1 FROM "team_group_member" m WHERE m."group_id" = g."id" AND m."user_id" = g."owner_user_id"
  );--> statement-breakpoint
INSERT INTO "brand_group" ("brand_id", "group_id", "created_at")
SELECT b."id", g."id", b."created_at"
FROM "brand" b
JOIN "team_group" g ON g."owner_user_id" = b."owner_id" AND g."kind" = 'personal'
WHERE NOT EXISTS (
  SELECT 1 FROM "brand_group" bg WHERE bg."brand_id" = b."id"
);--> statement-breakpoint
INSERT INTO "team_group_member" ("id", "group_id", "user_id", "active", "created_at", "revoked_at")
SELECT gen_random_uuid()::text, bg."group_id", g."user_id", 1, g."created_at", NULL
FROM "brand_member_grant" g
JOIN "brand_group" bg ON bg."brand_id" = g."brand_id"
WHERE g."active" = 1
ON CONFLICT ("group_id", "user_id") DO NOTHING;