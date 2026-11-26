PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sampling_plan` (
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`phase` text NOT NULL,
	`currency` text NOT NULL,
	`budget_minor` integer NOT NULL,
	`spent_minor` integer NOT NULL,
	`pending_minor` integer NOT NULL,
	`created_at` text NOT NULL,
	`trend_threshold_pp` real DEFAULT 10 NOT NULL,
	PRIMARY KEY(`id`, `version`),
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sampling_plan_state_check" CHECK("__new_sampling_plan"."version" > 0
    and "__new_sampling_plan"."phase" in ('draft', 'active', 'paused', 'ended')
    and length("__new_sampling_plan"."currency") = 3
    and "__new_sampling_plan"."budget_minor" >= 0 and "__new_sampling_plan"."spent_minor" >= 0 and "__new_sampling_plan"."pending_minor" >= 0
    and "__new_sampling_plan"."trend_threshold_pp" > 0
    and length("__new_sampling_plan"."owner_id") between 1 and 128
    and length("__new_sampling_plan"."created_at") between 20 and 40)
);
--> statement-breakpoint
INSERT INTO `__new_sampling_plan`("id", "version", "brand_id", "owner_id", "phase", "currency", "budget_minor", "spent_minor", "pending_minor", "created_at", "trend_threshold_pp") SELECT "id", "version", "brand_id", "owner_id", "phase", "currency", "budget_minor", "spent_minor", "pending_minor", "created_at", 10 FROM `sampling_plan`;--> statement-breakpoint
DROP TABLE `sampling_plan`;--> statement-breakpoint
CREATE TABLE `sampling_plan` (
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`phase` text NOT NULL,
	`currency` text NOT NULL,
	`budget_minor` integer NOT NULL,
	`spent_minor` integer NOT NULL,
	`pending_minor` integer NOT NULL,
	`created_at` text NOT NULL,
	`trend_threshold_pp` real DEFAULT 10 NOT NULL,
	PRIMARY KEY(`id`, `version`),
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sampling_plan_state_check" CHECK("sampling_plan"."version" > 0
    and "sampling_plan"."phase" in ('draft', 'active', 'paused', 'ended')
    and length("sampling_plan"."currency") = 3
    and "sampling_plan"."budget_minor" >= 0 and "sampling_plan"."spent_minor" >= 0 and "sampling_plan"."pending_minor" >= 0
    and "sampling_plan"."trend_threshold_pp" > 0
    and length("sampling_plan"."owner_id") between 1 and 128
    and length("sampling_plan"."created_at") between 20 and 40)
);
--> statement-breakpoint
INSERT INTO `sampling_plan`("id", "version", "brand_id", "owner_id", "phase", "currency", "budget_minor", "spent_minor", "pending_minor", "created_at", "trend_threshold_pp") SELECT "id", "version", "brand_id", "owner_id", "phase", "currency", "budget_minor", "spent_minor", "pending_minor", "created_at", "trend_threshold_pp" FROM `__new_sampling_plan`;--> statement-breakpoint
DROP TABLE `__new_sampling_plan`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sampling_plan_owner_idx` ON `sampling_plan` (`brand_id`,`owner_id`,`id`);
