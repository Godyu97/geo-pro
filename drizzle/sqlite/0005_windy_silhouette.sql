CREATE TABLE `brand_purge` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`frozen_at` text NOT NULL,
	`started_at` text NOT NULL,
	`step` integer NOT NULL,
	`issue` text,
	`completed_at` text,
	CONSTRAINT "brand_purge_step_check" CHECK("brand_purge"."step" between 0 and 3
    and (("brand_purge"."step" = 3 and "brand_purge"."completed_at" is not null and "brand_purge"."issue" is null)
      or ("brand_purge"."step" < 3 and "brand_purge"."completed_at" is null)))
);
--> statement-breakpoint
CREATE TABLE `brand_purged_cost` (
	`brand_id` text NOT NULL,
	`kind` text NOT NULL,
	`reservation_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`currency` text NOT NULL,
	`actual_minor` integer NOT NULL,
	`started_at` text NOT NULL,
	`reconciled_at` text NOT NULL,
	PRIMARY KEY(`brand_id`, `kind`, `reservation_id`, `attempt_id`),
	FOREIGN KEY (`brand_id`) REFERENCES `brand_purge`(`brand_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "brand_purged_cost_check" CHECK("brand_purged_cost"."kind" in ('sampling', 'generation')
    and length("brand_purged_cost"."currency") = 3 and "brand_purged_cost"."actual_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE `brand_operation` ADD `scope` text;--> statement-breakpoint
CREATE INDEX `brand_due_purge_idx` ON `brand` (`restore_until`,`id`) WHERE "brand"."restore_until" is not null;