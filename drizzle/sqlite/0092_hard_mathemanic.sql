CREATE TABLE `assistant_plan_review` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`executed_count` integer NOT NULL,
	`stale_blocked_count` integer NOT NULL,
	`next_step` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `assistant_plan`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assistant_plan_review_state_check" CHECK("assistant_plan_review"."executed_count" between 0 and 5
    and "assistant_plan_review"."stale_blocked_count" between 0 and 5
    and "assistant_plan_review"."executed_count" + "assistant_plan_review"."stale_blocked_count" between 1 and 5
    and length(trim("assistant_plan_review"."next_step")) between 1 and 500
    and length("assistant_plan_review"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_plan_review_plan_uidx` ON `assistant_plan_review` (`plan_id`);