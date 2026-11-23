CREATE TABLE `exploration_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`question_text` text NOT NULL,
	`answer_text` text NOT NULL,
	`exclusion_reason` text NOT NULL,
	`excluded_from_natural` integer DEFAULT 1 NOT NULL,
	`operation_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exploration_observation_state_check" CHECK("exploration_observation"."excluded_from_natural" = 1
    and "exploration_observation"."exclusion_reason" = 'custom_pipeline'
    and length("exploration_observation"."id") = 36 and length("exploration_observation"."brand_id") = 36
    and length("exploration_observation"."owner_id") between 1 and 128
    and length("exploration_observation"."question_text") between 1 and 4000
    and length("exploration_observation"."answer_text") between 1 and 8000
    and length("exploration_observation"."operation_id") = 36
    and length("exploration_observation"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exploration_observation_operation_uidx` ON `exploration_observation` (`brand_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `exploration_observation_owner_idx` ON `exploration_observation` (`owner_id`,`brand_id`,`created_at`,`id`);