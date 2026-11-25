PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `brand_member_grant` RENAME TO `__old_brand_member_grant`;--> statement-breakpoint
CREATE TABLE `brand_member_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`role` text NOT NULL,
	`active` integer NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "brand_member_grant_state_check" CHECK("brand_member_grant"."role" in ('owner', 'member', 'read_only')
    and "brand_member_grant"."active" in (0, 1)
    and length("brand_member_grant"."user_id") between 1 and 128
    and length("brand_member_grant"."created_at") between 20 and 40
    and ("brand_member_grant"."expires_at" is null or length("brand_member_grant"."expires_at") between 20 and 40)
    and (("brand_member_grant"."active" = 1 and "brand_member_grant"."revoked_at" is null)
      or ("brand_member_grant"."active" = 0 and length("brand_member_grant"."revoked_at") between 20 and 40)))
);--> statement-breakpoint
INSERT INTO `brand_member_grant`("id", "user_id", "brand_id", "role", "active", "expires_at", "created_at", "revoked_at") SELECT "id", "user_id", "brand_id", "role", "active", "expires_at", "created_at", "revoked_at" FROM `__old_brand_member_grant`;--> statement-breakpoint
ALTER TABLE `queued_brand_action` RENAME TO `__old_queued_brand_action`;--> statement-breakpoint
CREATE TABLE `queued_brand_action` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`status` text NOT NULL,
	`attachment` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`grant_id`) REFERENCES `brand_member_grant`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "queued_brand_action_state_check" CHECK("queued_brand_action"."status" in ('queued', 'stopped')
    and length("queued_brand_action"."attachment") between 16 and 64
    and length("queued_brand_action"."created_at") between 20 and 40)
);--> statement-breakpoint
INSERT INTO `queued_brand_action`("id", "grant_id", "status", "attachment", "created_at") SELECT "id", "grant_id", "status", "attachment", "created_at" FROM `__old_queued_brand_action`;--> statement-breakpoint
DROP TABLE `__old_queued_brand_action`;--> statement-breakpoint
DROP TABLE `__old_brand_member_grant`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `brand_member_grant_pair_uidx` ON `brand_member_grant` (`user_id`,`brand_id`);--> statement-breakpoint
CREATE INDEX `brand_member_grant_user_idx` ON `brand_member_grant` (`user_id`,`brand_id`) WHERE "brand_member_grant"."active" = 1;--> statement-breakpoint
CREATE INDEX `brand_member_grant_brand_idx` ON `brand_member_grant` (`brand_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `queued_brand_action_grant_idx` ON `queued_brand_action` (`grant_id`,`status`);
