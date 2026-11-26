CREATE TABLE `brand_group` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `team_group`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "brand_group_state_check" CHECK(length("brand_group"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `brand_group_group_idx` ON `brand_group` (`group_id`,`brand_id`);--> statement-breakpoint
CREATE TABLE `platform_account_role` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "platform_account_role_state_check" CHECK("platform_account_role"."role" in ('admin', 'user')
    and length("platform_account_role"."user_id") between 1 and 128
    and length("platform_account_role"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE `platform_role_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`subject_id` text,
	`role` text,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` text NOT NULL,
	CONSTRAINT "platform_role_audit_state_check" CHECK("platform_role_audit"."action" in ('grant', 'revoke')
    and "platform_role_audit"."result" in ('allowed', 'denied', 'failed')
    and ("platform_role_audit"."role" is null or "platform_role_audit"."role" in ('admin', 'user'))
    and length("platform_role_audit"."occurred_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `platform_role_audit_actor_time_idx` ON `platform_role_audit` (`actor_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE TABLE `team_group` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "team_group_state_check" CHECK("team_group"."kind" in ('personal', 'team')
    and length("team_group"."owner_user_id") between 1 and 128
    and length("team_group"."name") between 1 and 120
    and length("team_group"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_group_personal_uidx` ON `team_group` (`owner_user_id`) WHERE "team_group"."kind" = 'personal';--> statement-breakpoint
CREATE TABLE `team_group_member` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`active` integer NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`group_id`) REFERENCES `team_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "team_group_member_state_check" CHECK("team_group_member"."active" in (0, 1)
    and length("team_group_member"."user_id") between 1 and 128
    and length("team_group_member"."created_at") between 20 and 40
    and (("team_group_member"."active" = 1 and "team_group_member"."revoked_at" is null)
      or ("team_group_member"."active" = 0 and length("team_group_member"."revoked_at") between 20 and 40)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_group_member_pair_uidx` ON `team_group_member` (`group_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `team_group_member_user_idx` ON `team_group_member` (`user_id`,`group_id`) WHERE "team_group_member"."active" = 1;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_team_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`invitee_user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`replaced_by` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitee_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "team_invitation_state_check" CHECK("__new_team_invitation"."role" in ('member', 'read_only')
    and "__new_team_invitation"."status" in ('open', 'accepted', 'expired', 'revoked')
    and "__new_team_invitation"."invitee_user_id" <> "__new_team_invitation"."created_by"
    and length("__new_team_invitation"."invitee_user_id") between 1 and 128
    and length("__new_team_invitation"."created_by") between 1 and 128
    and length("__new_team_invitation"."token_hash") = 64
    and "__new_team_invitation"."token_hash" = lower("__new_team_invitation"."token_hash")
    and length("__new_team_invitation"."expires_at") between 20 and 40
    and length("__new_team_invitation"."created_at") between 20 and 40
    and (("__new_team_invitation"."status" in ('open', 'accepted', 'revoked') and "__new_team_invitation"."replaced_by" is null)
      or ("__new_team_invitation"."status" = 'expired' and ("__new_team_invitation"."replaced_by" is null or length("__new_team_invitation"."replaced_by") between 1 and 128))))
);
--> statement-breakpoint
INSERT INTO `__new_team_invitation`("id", "brand_id", "invitee_user_id", "created_by", "role", "token_hash", "expires_at", "status", "created_at", "replaced_by") SELECT "id", "brand_id", "invitee_user_id", "created_by", "role", "token_hash", "expires_at", "status", "created_at", "replaced_by" FROM `team_invitation`;--> statement-breakpoint
DROP TABLE `team_invitation`;--> statement-breakpoint
CREATE TABLE `team_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`invitee_user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`replaced_by` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitee_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "team_invitation_state_check" CHECK("team_invitation"."role" in ('member', 'read_only')
    and "team_invitation"."status" in ('open', 'accepted', 'expired', 'revoked')
    and "team_invitation"."invitee_user_id" <> "team_invitation"."created_by"
    and length("team_invitation"."invitee_user_id") between 1 and 128
    and length("team_invitation"."created_by") between 1 and 128
    and length("team_invitation"."token_hash") = 64
    and "team_invitation"."token_hash" = lower("team_invitation"."token_hash")
    and length("team_invitation"."expires_at") between 20 and 40
    and length("team_invitation"."created_at") between 20 and 40
    and (("team_invitation"."status" in ('open', 'accepted', 'revoked') and "team_invitation"."replaced_by" is null)
      or ("team_invitation"."status" = 'expired' and ("team_invitation"."replaced_by" is null or length("team_invitation"."replaced_by") between 1 and 128))))
);--> statement-breakpoint
INSERT INTO `team_invitation` SELECT * FROM `__new_team_invitation`;--> statement-breakpoint
DROP TABLE `__new_team_invitation`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `team_invitation_token_uidx` ON `team_invitation` (`token_hash`);--> statement-breakpoint
CREATE INDEX `team_invitation_invitee_idx` ON `team_invitation` (`invitee_user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `team_invitation_brand_idx` ON `team_invitation` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
INSERT INTO `platform_account_role` (`user_id`, `role`, `updated_at`)
SELECT u.`id`, 'user', '2026-11-26T00:00:00.000Z'
FROM `user` u
WHERE NOT EXISTS (
  SELECT 1 FROM `platform_account_role` r WHERE r.`user_id` = u.`id`
);--> statement-breakpoint
INSERT INTO `team_group` (`id`, `owner_user_id`, `kind`, `name`, `created_at`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  u.`id`, 'personal',
  CASE WHEN length(trim(u.`name`)) BETWEEN 1 AND 120 THEN trim(u.`name`) ELSE 'Personal' END,
  '2026-11-26T00:00:00.000Z'
FROM `user` u
WHERE NOT EXISTS (
  SELECT 1 FROM `team_group` g WHERE g.`owner_user_id` = u.`id` AND g.`kind` = 'personal'
);--> statement-breakpoint
INSERT INTO `team_group_member` (`id`, `group_id`, `user_id`, `active`, `created_at`, `revoked_at`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  g.`id`, g.`owner_user_id`, 1, g.`created_at`, NULL
FROM `team_group` g
WHERE g.`kind` = 'personal'
  AND NOT EXISTS (
    SELECT 1 FROM `team_group_member` m WHERE m.`group_id` = g.`id` AND m.`user_id` = g.`owner_user_id`
  );--> statement-breakpoint
INSERT INTO `brand_group` (`brand_id`, `group_id`, `created_at`)
SELECT b.`id`, g.`id`, b.`created_at`
FROM `brand` b
JOIN `team_group` g ON g.`owner_user_id` = b.`owner_id` AND g.`kind` = 'personal'
WHERE NOT EXISTS (
  SELECT 1 FROM `brand_group` bg WHERE bg.`brand_id` = b.`id`
);--> statement-breakpoint
INSERT OR IGNORE INTO `team_group_member` (`id`, `group_id`, `user_id`, `active`, `created_at`, `revoked_at`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  bg.`group_id`, g.`user_id`, 1, g.`created_at`, NULL
FROM `brand_member_grant` g
JOIN `brand_group` bg ON bg.`brand_id` = g.`brand_id`
WHERE g.`active` = 1;