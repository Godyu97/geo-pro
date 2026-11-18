CREATE TABLE `brand_fact_paste` (
	`brand_id` text NOT NULL,
	`id` text NOT NULL,
	`previous_id` text,
	`original` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`brand_id`, `id`),
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`,`previous_id`) REFERENCES `brand_fact_paste`(`brand_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fact_paste_parent_check" CHECK("brand_fact_paste"."previous_id" IS NULL OR "brand_fact_paste"."previous_id" <> "brand_fact_paste"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fact_paste_previous_uidx` ON `brand_fact_paste` (`brand_id`,`previous_id`);--> statement-breakpoint
CREATE INDEX `fact_paste_recent_idx` ON `brand_fact_paste` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `brand_fact_use` (
	`brand_id` text NOT NULL,
	`fact_version_id` text NOT NULL,
	`content_version_id` text NOT NULL,
	`stage` text NOT NULL,
	PRIMARY KEY(`brand_id`, `fact_version_id`, `content_version_id`),
	FOREIGN KEY (`brand_id`,`fact_version_id`) REFERENCES `brand_fact_version`(`brand_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fact_use_stage_check" CHECK("brand_fact_use"."stage" IN ('review', 'delivery', 'published', 'history'))
);
--> statement-breakpoint
CREATE INDEX `fact_use_content_idx` ON `brand_fact_use` (`brand_id`,`content_version_id`,`fact_version_id`);--> statement-breakpoint
CREATE TABLE `brand_fact_version` (
	`brand_id` text NOT NULL,
	`id` text NOT NULL,
	`fact_id` text NOT NULL,
	`version` integer NOT NULL,
	`entity_version` integer NOT NULL,
	`paste_id` text,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`confirmed_by` text,
	`confirmed_at` text,
	`revoked_at` text,
	PRIMARY KEY(`brand_id`, `id`),
	FOREIGN KEY (`brand_id`,`entity_version`) REFERENCES `brand_version`(`brand_id`,`version`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`,`paste_id`) REFERENCES `brand_fact_paste`(`brand_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fact_version_numbers_check" CHECK("brand_fact_version"."version" > 0 AND "brand_fact_version"."revision" > 0),
	CONSTRAINT "fact_version_state_check" CHECK(
    ("brand_fact_version"."state" IN ('draft', 'pending_confirmation') AND "brand_fact_version"."confirmed_by" IS NULL AND "brand_fact_version"."confirmed_at" IS NULL AND "brand_fact_version"."revoked_at" IS NULL)
    OR ("brand_fact_version"."confirmed_by" IS NOT NULL AND "brand_fact_version"."confirmed_at" IS NOT NULL AND
      (("brand_fact_version"."state" = 'approved' AND "brand_fact_version"."revoked_at" IS NULL) OR ("brand_fact_version"."state" = 'revoked' AND "brand_fact_version"."revoked_at" IS NOT NULL))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fact_version_number_uidx` ON `brand_fact_version` (`brand_id`,`fact_id`,`version`);--> statement-breakpoint
CREATE INDEX `fact_entity_version_idx` ON `brand_fact_version` (`brand_id`,`entity_version`);--> statement-breakpoint
CREATE INDEX `fact_version_paste_idx` ON `brand_fact_version` (`brand_id`,`paste_id`) WHERE "brand_fact_version"."paste_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `fact_version_recent_idx` ON `brand_fact_version` (`brand_id`,`created_at`,`id`);