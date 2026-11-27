CREATE TABLE `lead_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`real_need` integer,
	`target_industry` integer,
	`can_follow_up` integer,
	`outcome` text NOT NULL,
	`recorded_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `business_lead`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `lead_validity_rule`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lead_feedback_state_check" CHECK("lead_feedback"."revision" > 0
    and "lead_feedback"."status" in ('qualified', 'disqualified', 'unknown')
    and "lead_feedback"."real_need" in (0, 1)
    and "lead_feedback"."target_industry" in (0, 1)
    and "lead_feedback"."can_follow_up" in (0, 1)
    and "lead_feedback"."outcome" in ('unknown', 'pending', 'contacted', 'won', 'lost')
    and length("lead_feedback"."recorded_by") between 1 and 128
    and length("lead_feedback"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_feedback_lead_revision_uidx` ON `lead_feedback` (`lead_id`,`revision`);--> statement-breakpoint
CREATE INDEX `lead_feedback_rule_idx` ON `lead_feedback` (`rule_id`);