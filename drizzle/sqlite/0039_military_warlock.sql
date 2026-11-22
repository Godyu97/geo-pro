CREATE TABLE `assistant_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`material_hash` text NOT NULL,
	`status` text NOT NULL,
	`controls_unchanged` integer NOT NULL,
	`ignored` integer NOT NULL,
	`budget_minor` integer NOT NULL,
	`strategy_label` text NOT NULL,
	`guaranteed` integer NOT NULL,
	`successes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assistant_plan_state_check" CHECK("assistant_plan"."status" in ('draft', 'settled')
    and "assistant_plan"."controls_unchanged" = 1
    and "assistant_plan"."ignored" in (0, 1)
    and "assistant_plan"."budget_minor" between 0 and 1000000000
    and "assistant_plan"."strategy_label" = 'observation'
    and "assistant_plan"."guaranteed" = 0
    and "assistant_plan"."successes" between 0 and 1000000
    and length("assistant_plan"."material_hash") = 64
    and length("assistant_plan"."owner_id") between 1 and 128
    and length("assistant_plan"."created_at") between 20 and 40
    and length("assistant_plan"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `assistant_plan_owner_idx` ON `assistant_plan` (`owner_id`,`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `assistant_plan_item` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`position` integer NOT NULL,
	`action_text` text NOT NULL,
	`fact_version_id` text NOT NULL,
	`fact_current` integer NOT NULL,
	`status` text NOT NULL,
	`block_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `assistant_plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`,`fact_version_id`) REFERENCES `brand_fact_version`(`brand_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assistant_plan_item_state_check" CHECK("assistant_plan_item"."position" between 1 and 5
    and "assistant_plan_item"."fact_current" in (0, 1)
    and "assistant_plan_item"."status" in ('draft', 'confirmed', 'executed', 'blocked')
    and (
      ("assistant_plan_item"."status" = 'blocked' and "assistant_plan_item"."block_reason" = 'fact_stale')
      or ("assistant_plan_item"."status" <> 'blocked' and "assistant_plan_item"."block_reason" is null)
    )
    and length("assistant_plan_item"."action_text") between 1 and 200
    and length("assistant_plan_item"."fact_version_id") between 1 and 64
    and length("assistant_plan_item"."owner_id") between 1 and 128
    and length("assistant_plan_item"."created_at") between 20 and 40
    and length("assistant_plan_item"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_plan_item_position_uidx` ON `assistant_plan_item` (`plan_id`,`position`);--> statement-breakpoint
CREATE INDEX `assistant_plan_item_owner_idx` ON `assistant_plan_item` (`owner_id`,`plan_id`,`position`);