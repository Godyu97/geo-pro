CREATE TABLE `content_template` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`owner_id` text,
	`is_system` integer NOT NULL,
	`source_template_id` text,
	`fact_gate` integer NOT NULL,
	`public_license_gate` integer NOT NULL,
	`review_gate` integer NOT NULL,
	`status` text NOT NULL,
	`asks_to_invent_case_study` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_template_id`) REFERENCES `content_template`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "content_template_state_check" CHECK("content_template"."is_system" in (0, 1)
    and "content_template"."fact_gate" in (0, 1)
    and "content_template"."public_license_gate" in (0, 1)
    and "content_template"."review_gate" in (0, 1)
    and "content_template"."asks_to_invent_case_study" in (0, 1)
    and "content_template"."status" in ('draft', 'published', 'retired')
    and length("content_template"."id") = 36
    and length("content_template"."name") between 1 and 120
    and length("content_template"."created_at") between 20 and 40
    and length("content_template"."updated_at") between 20 and 40
    and ("content_template"."brand_id" is null or length("content_template"."brand_id") = 36)
    and ("content_template"."owner_id" is null or length("content_template"."owner_id") between 1 and 128)
    and ("content_template"."source_template_id" is null or length("content_template"."source_template_id") = 36)
    and (
      ("content_template"."is_system" = 1 and "content_template"."brand_id" is null and "content_template"."owner_id" is null and "content_template"."source_template_id" is null)
      or ("content_template"."is_system" = 0 and "content_template"."brand_id" is not null and "content_template"."owner_id" is not null
        and "content_template"."source_template_id" is not null
        and "content_template"."fact_gate" = 1 and "content_template"."public_license_gate" = 1 and "content_template"."review_gate" = 1)
    ))
);
--> statement-breakpoint
CREATE INDEX `content_template_system_idx` ON `content_template` (`is_system`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `content_template_owner_idx` ON `content_template` (`owner_id`,`brand_id`,`created_at`,`id`);