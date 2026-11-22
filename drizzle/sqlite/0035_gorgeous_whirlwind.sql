CREATE TABLE `entity_correction` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`action` text NOT NULL,
	`effect` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `answer_observation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_correction_state_check" CHECK((("entity_correction"."action" = 'open' and "entity_correction"."effect" in ('open', 'unresolved'))
      or ("entity_correction"."action" = 'actioned' and "entity_correction"."effect" in ('pending_retest', 'unresolved')))
    and length("entity_correction"."owner_id") between 1 and 128
    and length("entity_correction"."observation_id") = 36
    and length("entity_correction"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_correction_event_uidx` ON `entity_correction` (`observation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `entity_correction_owner_idx` ON `entity_correction` (`owner_id`,`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `entity_disambiguation` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`prior_analysis_id` text NOT NULL,
	`next_analysis_id` text NOT NULL,
	`count_as_target_mention` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `answer_observation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prior_analysis_id`) REFERENCES `answer_analysis_version`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`next_analysis_id`) REFERENCES `answer_analysis_version`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_disambiguation_state_check" CHECK("entity_disambiguation"."count_as_target_mention" = 0
    and "entity_disambiguation"."prior_analysis_id" <> "entity_disambiguation"."next_analysis_id"
    and length("entity_disambiguation"."owner_id") between 1 and 128
    and length("entity_disambiguation"."observation_id") = 36
    and length("entity_disambiguation"."prior_analysis_id") = 36
    and length("entity_disambiguation"."next_analysis_id") = 36
    and length("entity_disambiguation"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_disambiguation_prior_uidx` ON `entity_disambiguation` (`prior_analysis_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_disambiguation_next_uidx` ON `entity_disambiguation` (`next_analysis_id`);--> statement-breakpoint
CREATE INDEX `entity_disambiguation_owner_idx` ON `entity_disambiguation` (`owner_id`,`brand_id`,`created_at`,`id`);