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
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_version_id`) REFERENCES `content_version`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approval_id`) REFERENCES `content_approval`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "content_channel_variant_state_check" CHECK("content_channel_variant"."approval_status" in ('draft', 'approved')
    and "content_channel_variant"."needs_own_approval" in (0, 1)
    and "content_channel_variant"."blocked" in (0, 1)
    and length("content_channel_variant"."channel") > 0
    and length("content_channel_variant"."body_markdown") > 0
    and length("content_channel_variant"."fingerprint") > 0
    and length("content_channel_variant"."created_at") between 20 and 40
    and length("content_channel_variant"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_channel_variant_channel_uidx` ON `content_channel_variant` (`content_version_id`,`channel`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_channel_variant_approval_uidx` ON `content_channel_variant` (`approval_id`);--> statement-breakpoint
CREATE INDEX `content_channel_variant_owner_idx` ON `content_channel_variant` (`owner_id`,`brand_id`,`updated_at`,`id`);