CREATE TABLE `answer_analysis_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`mentioned` text NOT NULL,
	`recommended` text NOT NULL,
	`official_site_cited` text NOT NULL,
	`status` text NOT NULL,
	`model_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `answer_observation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "answer_analysis_draft_state_check" CHECK("answer_analysis_draft"."mentioned" in ('true', 'false', 'unknown')
    and "answer_analysis_draft"."recommended" in ('true', 'false', 'unknown')
    and "answer_analysis_draft"."official_site_cited" in ('true', 'false', 'unknown')
    and "answer_analysis_draft"."status" in ('draft', 'applied', 'dismissed')
    and length("answer_analysis_draft"."model_name") between 1 and 128
    and length("answer_analysis_draft"."owner_id") between 1 and 128
    and length("answer_analysis_draft"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `answer_analysis_draft_observation_idx` ON `answer_analysis_draft` (`observation_id`,`created_at`);