CREATE TABLE `source_original_fragment` (
	`id` text PRIMARY KEY NOT NULL,
	`source_original_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`page` integer,
	`excerpt` text,
	`candidate_state` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_original_id`) REFERENCES `source_original`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_original_fragment_state_check" CHECK("source_original_fragment"."candidate_state" = 'unapproved'
    and "source_original_fragment"."ordinal" between 0 and 199
    and ("source_original_fragment"."page" is null or "source_original_fragment"."page" between 1 and 100000)
    and ("source_original_fragment"."excerpt" is null or length("source_original_fragment"."excerpt") between 1 and 50000)
    and length("source_original_fragment"."id") = 36
    and length("source_original_fragment"."source_original_id") = 36
    and length("source_original_fragment"."brand_id") = 36
    and length("source_original_fragment"."owner_id") between 1 and 128
    and length("source_original_fragment"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_original_fragment_ordinal_uidx` ON `source_original_fragment` (`source_original_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `source_original_fragment_brand_idx` ON `source_original_fragment` (`brand_id`,`source_original_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `source_original_fragment_conflict` (
	`fragment_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`fact_version_id` text NOT NULL,
	`fact_version` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fragment_id`) REFERENCES `source_original_fragment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`,`fact_version_id`) REFERENCES `brand_fact_version`(`brand_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_original_fragment_conflict_state_check" CHECK("source_original_fragment_conflict"."fact_version" > 0
    and length("source_original_fragment_conflict"."fragment_id") = 36
    and length("source_original_fragment_conflict"."brand_id") = 36
    and length("source_original_fragment_conflict"."fact_version_id") = 36)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_original_fragment_conflict_uidx` ON `source_original_fragment_conflict` (`fragment_id`,`fact_version_id`);--> statement-breakpoint
CREATE INDEX `source_original_fragment_conflict_brand_idx` ON `source_original_fragment_conflict` (`brand_id`,`fragment_id`,`fact_version`,`fact_version_id`);