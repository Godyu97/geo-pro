PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_brand_group` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `team_group`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "brand_group_state_check" CHECK(length("__new_brand_group"."created_at") between 20 and 40)
);
--> statement-breakpoint
INSERT INTO `__new_brand_group`("brand_id", "group_id", "created_at") SELECT "brand_id", "group_id", "created_at" FROM `brand_group`;--> statement-breakpoint
DROP TABLE `brand_group`;--> statement-breakpoint
CREATE TABLE `brand_group` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `team_group`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "brand_group_state_check" CHECK(length("brand_group"."created_at") between 20 and 40)
);--> statement-breakpoint
INSERT INTO `brand_group`("brand_id", "group_id", "created_at") SELECT "brand_id", "group_id", "created_at" FROM `__new_brand_group`;--> statement-breakpoint
DROP TABLE `__new_brand_group`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `brand_group_group_idx` ON `brand_group` (`group_id`,`brand_id`);