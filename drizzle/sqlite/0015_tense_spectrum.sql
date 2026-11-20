CREATE TABLE `content_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`status` text NOT NULL,
	`reservation_id` text,
	`operation_id` text NOT NULL,
	`cost_ledger_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "content_batch_state_check" CHECK("content_batch"."status" in ('queued', 'running', 'paused', 'partial', 'completed', 'cancelled')
    and length("content_batch"."cost_ledger_json") > 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_batch_operation_uidx` ON `content_batch` (`brand_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `content_batch_brand_idx` ON `content_batch` (`brand_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `content_batch_owner_idx` ON `content_batch` (`owner_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `content_batch_unit` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`brief_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`content_version_id` text,
	`last_error` text,
	`blocked_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `content_batch`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brief_id`) REFERENCES `content_brief`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "content_batch_unit_state_check" CHECK("content_batch_unit"."status" in ('queued', 'running', 'succeeded', 'failed', 'blocked')
    and "content_batch_unit"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `content_batch_unit_batch_idx` ON `content_batch_unit` (`batch_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `content_batch_unit_brand_idx` ON `content_batch_unit` (`brand_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `content_brief` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`plan_id` text,
	`optimization_task_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `content_plan`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "content_brief_state_check" CHECK("content_brief"."status" in ('draft', 'confirmed', 'invalidated'))
);
--> statement-breakpoint
CREATE INDEX `content_brief_brand_idx` ON `content_brief` (`brand_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `content_brief_owner_idx` ON `content_brief` (`owner_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `content_brief_version` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`revision` integer NOT NULL,
	`audience` text NOT NULL,
	`target_gap` text NOT NULL,
	`applicable_boundary` text NOT NULL,
	`primary_page` text NOT NULL,
	`conversion_action` text NOT NULL,
	`template_kind` text NOT NULL,
	`title_candidates_json` text NOT NULL,
	`fact_version_ids_json` text NOT NULL,
	`competitor_source` text,
	`confirmed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brief_id`) REFERENCES `content_brief`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "content_brief_version_state_check" CHECK("content_brief_version"."revision" > 0
    and "content_brief_version"."template_kind" in ('fact_faq', 'scenario_solution', 'verifiable_comparison')
    and length("content_brief_version"."title_candidates_json") > 1
    and length("content_brief_version"."fact_version_ids_json") > 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_brief_version_rev_uidx` ON `content_brief_version` (`brief_id`,`revision`);--> statement-breakpoint
CREATE INDEX `content_brief_version_brand_idx` ON `content_brief_version` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `content_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`question_cluster` text NOT NULL,
	`coverage_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "content_plan_state_check" CHECK(length("content_plan"."question_cluster") > 0 and length("content_plan"."coverage_json") > 1)
);
--> statement-breakpoint
CREATE INDEX `content_plan_brand_idx` ON `content_plan` (`brand_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `content_plan_owner_idx` ON `content_plan` (`owner_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_plan_cluster_uidx` ON `content_plan` (`brand_id`,`question_cluster`);--> statement-breakpoint
CREATE TABLE `content_version` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`brief_id` text NOT NULL,
	`brief_version_id` text NOT NULL,
	`batch_unit_id` text NOT NULL,
	`template_kind` text NOT NULL,
	`title` text NOT NULL,
	`body_markdown` text NOT NULL,
	`claims_json` text NOT NULL,
	`status` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brief_id`) REFERENCES `content_brief`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`brief_version_id`) REFERENCES `content_brief_version`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_unit_id`) REFERENCES `content_batch_unit`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "content_version_state_check" CHECK("content_version"."status" = 'draft'
    and "content_version"."template_kind" in ('fact_faq', 'scenario_solution', 'verifiable_comparison')
    and length("content_version"."title") > 0
    and length("content_version"."body_markdown") > 0
    and length("content_version"."claims_json") > 1
    and length("content_version"."fingerprint") > 0)
);
--> statement-breakpoint
CREATE INDEX `content_version_brand_idx` ON `content_version` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `content_version_owner_idx` ON `content_version` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `content_version_brief_idx` ON `content_version` (`brief_id`,`created_at`,`id`);