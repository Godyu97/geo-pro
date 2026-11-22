CREATE TABLE `optimization_action_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`evidence_ids` text NOT NULL,
	`gap_type` text NOT NULL,
	`observed_gap` text NOT NULL,
	`hypothesis` text NOT NULL,
	`assumption_level` text NOT NULL,
	`question_cluster` text NOT NULL,
	`target_page` text NOT NULL,
	`status` text NOT NULL,
	`model_name` text NOT NULL,
	`task_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "optimization_action_draft_state_check" CHECK("optimization_action_draft"."gap_type" in ('fact_error', 'name_confusion', 'key_content_missing', 'page_unreadable', 'citation_gap', 'needs_evidence')
    and "optimization_action_draft"."assumption_level" in ('observed_absence', 'verified', 'pending')
    and "optimization_action_draft"."status" in ('draft', 'confirmed', 'dismissed')
    and (
      ("optimization_action_draft"."status" = 'confirmed' and "optimization_action_draft"."task_id" is not null)
      or ("optimization_action_draft"."status" <> 'confirmed' and "optimization_action_draft"."task_id" is null)
    )
    and length("optimization_action_draft"."model_name") between 1 and 128
    and length("optimization_action_draft"."owner_id") between 1 and 128
    and length("optimization_action_draft"."created_at") between 20 and 40
    and length("optimization_action_draft"."evidence_ids") between 38 and 400
    and length("optimization_action_draft"."observed_gap") between 1 and 500
    and length("optimization_action_draft"."hypothesis") between 1 and 500
    and length("optimization_action_draft"."question_cluster") > 0
    and length("optimization_action_draft"."target_page") > 0)
);
--> statement-breakpoint
CREATE INDEX `optimization_action_draft_owner_idx` ON `optimization_action_draft` (`owner_id`,`brand_id`,`status`,`created_at`,`id`);