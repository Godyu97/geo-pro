CREATE TABLE `channel_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`channel_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channel_profile_state_check" CHECK(length("channel_profile"."channel_key") between 1 and 64
    and length("channel_profile"."created_at") between 20 and 40
    and length("channel_profile"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_brand_channel_uidx` ON `channel_profile` (`brand_id`,`channel_key`);--> statement-breakpoint
CREATE INDEX `channel_profile_owner_idx` ON `channel_profile` (`owner_id`,`brand_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `channel_profile_version` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`channel_key` text NOT NULL,
	`max_characters` integer,
	`note` text NOT NULL,
	`version_number` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `channel_profile`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "channel_profile_version_state_check" CHECK(length("channel_profile_version"."channel_key") between 1 and 64
    and ("channel_profile_version"."max_characters" is null or "channel_profile_version"."max_characters" between 1 and 1000000)
    and length("channel_profile_version"."note") between 1 and 2000
    and "channel_profile_version"."version_number" between 1 and 1000000
    and length("channel_profile_version"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_profile_version_number_uidx` ON `channel_profile_version` (`profile_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `channel_profile_version_owner_idx` ON `channel_profile_version` (`owner_id`,`brand_id`,`channel_key`,`version_number`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `content_channel_variant` RENAME TO `__old_content_channel_variant`;--> statement-breakpoint
CREATE TABLE `content_channel_variant` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`content_version_id` text NOT NULL,
	`channel` text NOT NULL,
	`body_markdown` text NOT NULL,
	`approval_status` text NOT NULL,
	`approval_id` text,
	`needs_own_approval` integer NOT NULL,
	`blocked` integer DEFAULT 0 NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`channel_profile_version_id` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_version_id`) REFERENCES `content_version`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approval_id`) REFERENCES `content_approval`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`channel_profile_version_id`) REFERENCES `channel_profile_version`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "content_channel_variant_state_check" CHECK("content_channel_variant"."approval_status" in ('draft', 'approved')
    and "content_channel_variant"."needs_own_approval" in (0, 1)
    and "content_channel_variant"."blocked" in (0, 1)
    and length("content_channel_variant"."channel") > 0
    and length("content_channel_variant"."body_markdown") > 0
    and length("content_channel_variant"."fingerprint") > 0
    and length("content_channel_variant"."created_at") between 20 and 40
    and length("content_channel_variant"."updated_at") between 20 and 40)
);--> statement-breakpoint
INSERT INTO `content_channel_variant` (
	"id", "brand_id", "owner_id", "content_version_id", "channel", "body_markdown",
	"approval_status", "approval_id", "needs_own_approval", "blocked", "fingerprint",
	"created_at", "updated_at", "channel_profile_version_id"
) SELECT
	"id", "brand_id", "owner_id", "content_version_id", "channel", "body_markdown",
	"approval_status", "approval_id", "needs_own_approval", "blocked", "fingerprint",
	"created_at", "updated_at", NULL
FROM `__old_content_channel_variant`;--> statement-breakpoint
DROP TABLE `__old_content_channel_variant`;--> statement-breakpoint
CREATE UNIQUE INDEX `content_channel_variant_channel_uidx` ON `content_channel_variant` (`content_version_id`,`channel`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_channel_variant_approval_uidx` ON `content_channel_variant` (`approval_id`);--> statement-breakpoint
CREATE INDEX `content_channel_variant_owner_idx` ON `content_channel_variant` (`owner_id`,`brand_id`,`updated_at`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;