PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_content_maintenance_task` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`fact_version_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_content_maintenance_task`("id", "brand_id", "owner_id", "fact_version_id", "status", "reason", "created_at", "updated_at") SELECT "id", "brand_id", "owner_id", "fact_version_id", "status", "reason", "created_at", "updated_at" FROM `content_maintenance_task`;--> statement-breakpoint
DROP TABLE `content_maintenance_task`;--> statement-breakpoint
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
    and "content_maintenance_task"."reason" in ('expired', 'revoked', 'mismatch', 'removed')
    and length("content_maintenance_task"."created_at") between 20 and 40
    and length("content_maintenance_task"."updated_at") between 20 and 40)
);
--> statement-breakpoint
INSERT INTO `content_maintenance_task`("id", "brand_id", "owner_id", "fact_version_id", "status", "reason", "created_at", "updated_at") SELECT "id", "brand_id", "owner_id", "fact_version_id", "status", "reason", "created_at", "updated_at" FROM `__new_content_maintenance_task`;--> statement-breakpoint
DROP TABLE `__new_content_maintenance_task`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `content_maintenance_task_open_uidx` ON `content_maintenance_task` (`brand_id`,`fact_version_id`) WHERE "content_maintenance_task"."status" = 'open';--> statement-breakpoint
CREATE INDEX `content_maintenance_task_owner_idx` ON `content_maintenance_task` (`owner_id`,`brand_id`,`updated_at`,`id`);
