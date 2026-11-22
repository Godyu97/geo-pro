CREATE TABLE `content_maintenance_task` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`fact_version_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`,`fact_version_id`) REFERENCES `brand_fact_version`(`brand_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "content_maintenance_task_state_check" CHECK("content_maintenance_task"."status" in ('open', 'closed')
    and "content_maintenance_task"."reason" in ('expired', 'revoked')
    and length("content_maintenance_task"."created_at") between 20 and 40
    and length("content_maintenance_task"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_maintenance_task_open_uidx` ON `content_maintenance_task` (`brand_id`,`fact_version_id`) WHERE "content_maintenance_task"."status" = 'open';--> statement-breakpoint
CREATE INDEX `content_maintenance_task_owner_idx` ON `content_maintenance_task` (`owner_id`,`brand_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `content_maintenance_page` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`page_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`page_url` text NOT NULL,
	`channel` text NOT NULL,
	`planned_on` text,
	`verified_on` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `content_maintenance_task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `content_version`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "content_maintenance_page_state_check" CHECK("content_maintenance_page"."status" in ('planned', 'verified', 'blocked')
    and length("content_maintenance_page"."channel") between 1 and 64
    and length("content_maintenance_page"."page_url") > 0
    and length("content_maintenance_page"."page_id") > 0
    and ("content_maintenance_page"."planned_on" is null or length("content_maintenance_page"."planned_on") = 10)
    and ("content_maintenance_page"."verified_on" is null or length("content_maintenance_page"."verified_on") = 10)
    and ("content_maintenance_page"."status" <> 'verified' or "content_maintenance_page"."verified_on" is not null)
    and ("content_maintenance_page"."status" <> 'planned' or "content_maintenance_page"."verified_on" is null)
    and length("content_maintenance_page"."created_at") between 20 and 40
    and length("content_maintenance_page"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_maintenance_page_page_uidx` ON `content_maintenance_page` (`task_id`,`page_id`);--> statement-breakpoint
CREATE INDEX `content_maintenance_page_task_idx` ON `content_maintenance_page` (`owner_id`,`task_id`,`channel`,`id`);
