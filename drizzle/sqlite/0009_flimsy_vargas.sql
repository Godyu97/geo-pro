CREATE TABLE `prompt_draft` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`base_set_id` text,
	`content` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prompt_draft_revision_check" CHECK("prompt_draft"."revision" > 0),
	CONSTRAINT "prompt_draft_content_check" CHECK(length("prompt_draft"."content") > 1)
);
--> statement-breakpoint
CREATE TABLE `prompt_set` (
	`brand_id` text NOT NULL,
	`id` text NOT NULL,
	`set_id` text NOT NULL,
	`version` integer NOT NULL,
	`entity_version` integer NOT NULL,
	`region` text NOT NULL,
	`language` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`brand_id`, `id`),
	FOREIGN KEY (`brand_id`,`entity_version`) REFERENCES `brand_version`(`brand_id`,`version`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prompt_set_version_check" CHECK("prompt_set"."version" > 0),
	CONSTRAINT "prompt_set_region_check" CHECK(length("prompt_set"."region") = 2),
	CONSTRAINT "prompt_set_language_check" CHECK(length("prompt_set"."language") BETWEEN 2 AND 40),
	CONSTRAINT "prompt_set_content_check" CHECK(length("prompt_set"."content") > 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_set_version_uidx` ON `prompt_set` (`brand_id`,`set_id`,`version`);--> statement-breakpoint
CREATE INDEX `prompt_set_recent_idx` ON `prompt_set` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `prompt_reference` (
	`brand_id` text NOT NULL,
	`set_version_id` text NOT NULL,
	`question_id` text NOT NULL,
	`consumer_id` text NOT NULL,
	PRIMARY KEY(`brand_id`, `set_version_id`, `question_id`, `consumer_id`),
	FOREIGN KEY (`brand_id`,`set_version_id`) REFERENCES `prompt_set`(`brand_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prompt_reference_question_idx` ON `prompt_reference` (`brand_id`,`question_id`);
