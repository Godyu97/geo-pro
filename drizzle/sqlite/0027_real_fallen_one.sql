PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_brand_purge` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`frozen_at` text NOT NULL,
	`started_at` text NOT NULL,
	`step` integer NOT NULL,
	`issue` text,
	`completed_at` text
);
--> statement-breakpoint
INSERT INTO `__new_brand_purge` (`brand_id`, `owner_id`, `frozen_at`, `started_at`, `step`, `issue`, `completed_at`) SELECT `brand_id`, `owner_id`, `frozen_at`, `started_at`, CASE WHEN `step` = 3 THEN 4 ELSE `step` END, `issue`, `completed_at` FROM `brand_purge`;--> statement-breakpoint
DROP TABLE `brand_purge`;--> statement-breakpoint
CREATE TABLE `brand_purge` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`frozen_at` text NOT NULL,
	`started_at` text NOT NULL,
	`step` integer NOT NULL,
	`issue` text,
	`completed_at` text,
	CONSTRAINT "brand_purge_step_check" CHECK("brand_purge"."step" between 0 and 4
    and (("brand_purge"."step" = 4 and "brand_purge"."completed_at" is not null and "brand_purge"."issue" is null)
      or ("brand_purge"."step" < 4 and "brand_purge"."completed_at" is null)))
);
--> statement-breakpoint
INSERT INTO `brand_purge` (`brand_id`, `owner_id`, `frozen_at`, `started_at`, `step`, `issue`, `completed_at`) SELECT `brand_id`, `owner_id`, `frozen_at`, `started_at`, `step`, `issue`, `completed_at` FROM `__new_brand_purge`;--> statement-breakpoint
DROP TABLE `__new_brand_purge`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
