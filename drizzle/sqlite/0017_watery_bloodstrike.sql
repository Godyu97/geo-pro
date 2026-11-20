CREATE TABLE `content_publication` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`content_version_id` text NOT NULL,
	`approval_id` text NOT NULL,
	`content_fingerprint` text NOT NULL,
	`target_account` text NOT NULL,
	`page_url` text NOT NULL,
	`publisher_id` text NOT NULL,
	`claimed_published_at` text NOT NULL,
	`channel_declaration` text NOT NULL,
	`status` text NOT NULL,
	`effective_at` text,
	`evidence_grade` text,
	`superseded_by` text,
	`operation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_version_id`) REFERENCES `content_version`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approval_id`) REFERENCES `content_approval`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "content_publication_state_check" CHECK("content_publication"."status" in (
      'prepared', 'submitted', 'draft_only', 'pending_check', 'verified_public',
      'verified_manual', 'mismatch', 'access_limited', 'removed')
    and ("content_publication"."evidence_grade" is null or "content_publication"."evidence_grade" in ('public', 'manual'))
    and length("content_publication"."content_fingerprint") > 0
    and length("content_publication"."page_url") > 0
    and length("content_publication"."target_account") > 0
    and length("content_publication"."channel_declaration") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_publication_operation_uidx` ON `content_publication` (`brand_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `content_publication_version_idx` ON `content_publication` (`content_version_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `content_publication_brand_idx` ON `content_publication` (`brand_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `content_publication_owner_idx` ON `content_publication` (`owner_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `content_publication_action` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`publication_id`) REFERENCES `content_publication`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "content_publication_action_state_check" CHECK("content_publication_action"."kind" in ('repair_mismatch', 'confirm_removal', 'reverify')
    and "content_publication_action"."status" in ('open', 'done', 'cancelled')
    and length("content_publication_action"."reason") > 0)
);
--> statement-breakpoint
CREATE INDEX `content_publication_action_publication_idx` ON `content_publication_action` (`publication_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `content_publication_action_brand_idx` ON `content_publication_action` (`brand_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `content_publication_check` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`method` text NOT NULL,
	`result_status` text NOT NULL,
	`evidence_json` text NOT NULL,
	`actor_id` text NOT NULL,
	`checked_at` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`publication_id`) REFERENCES `content_publication`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "content_publication_check_state_check" CHECK("content_publication_check"."method" in ('public_fetch', 'manual_evidence')
    and "content_publication_check"."result_status" in (
      'draft_only', 'pending_check', 'verified_public', 'verified_manual',
      'mismatch', 'access_limited', 'removed')
    and length("content_publication_check"."evidence_json") > 1)
);
--> statement-breakpoint
CREATE INDEX `content_publication_check_publication_idx` ON `content_publication_check` (`publication_id`,`checked_at`,`id`);--> statement-breakpoint
CREATE INDEX `content_publication_check_brand_idx` ON `content_publication_check` (`brand_id`,`checked_at`,`id`);