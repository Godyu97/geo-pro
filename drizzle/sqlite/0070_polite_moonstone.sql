CREATE TABLE `retention_policy` (
	`version` integer PRIMARY KEY NOT NULL,
	`summary_zh` text NOT NULL,
	`summary_en` text NOT NULL,
	`recoverable_days` integer NOT NULL,
	`published_at` text NOT NULL,
	CONSTRAINT "retention_policy_version_check" CHECK("retention_policy"."version" > 0),
	CONSTRAINT "retention_policy_days_check" CHECK("retention_policy"."recoverable_days" between 1 and 3650),
	CONSTRAINT "retention_policy_summary_check" CHECK(length("retention_policy"."summary_zh") between 1 and 2000
    and length("retention_policy"."summary_en") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE `brand_retention_acceptance` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`policy_version` integer NOT NULL,
	`accepted_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_version`) REFERENCES `retention_policy`(`version`) ON UPDATE no action ON DELETE no action
);
