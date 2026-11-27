PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_capture_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`blocked_by` text,
	`citation_count` integer NOT NULL,
	`status` text NOT NULL,
	`confirmed` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`prompt_id` text,
	`question_text` text,
	`answer_text` text,
	`citations_json` text,
	`citation_set_state` text,
	`locator_ref` text,
	`collector_id` text,
	`requested_network_mode` text,
	`target_region` text,
	`observed_region` text,
	`new_session` text,
	`product_mode` text,
	`observation_id` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_id`) REFERENCES `capture_sheet`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `answer_observation`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "capture_attempt_state_check" CHECK("__new_capture_attempt"."status" in ('handoff', 'partial', 'preview')
    and "__new_capture_attempt"."confirmed" in (0, 1)
    and "__new_capture_attempt"."citation_count" between 0 and 1000
    and (
      ("__new_capture_attempt"."blocked_by" in ('captcha', 'login') and "__new_capture_attempt"."status" = 'handoff' and "__new_capture_attempt"."confirmed" = 0)
      or ("__new_capture_attempt"."blocked_by" is null and "__new_capture_attempt"."citation_count" = 0 and "__new_capture_attempt"."status" = 'partial')
      or ("__new_capture_attempt"."blocked_by" is null and "__new_capture_attempt"."citation_count" between 1 and 1000 and "__new_capture_attempt"."status" = 'preview')
    )
    and length("__new_capture_attempt"."id") = 36
    and length("__new_capture_attempt"."sheet_id") = 36
    and length("__new_capture_attempt"."brand_id") = 36
    and length("__new_capture_attempt"."owner_id") between 1 and 128
    and ("__new_capture_attempt"."blocked_by" is null or length("__new_capture_attempt"."blocked_by") between 5 and 7)
    and length("__new_capture_attempt"."created_at") between 20 and 40
    and length("__new_capture_attempt"."updated_at") between 20 and 40
    and ("__new_capture_attempt"."prompt_id" is null or length("__new_capture_attempt"."prompt_id") = 36)
    and ("__new_capture_attempt"."citation_set_state" is null or "__new_capture_attempt"."citation_set_state" in ('complete', 'partial', 'unsupported', 'missing'))
    and ("__new_capture_attempt"."requested_network_mode" is null or "__new_capture_attempt"."requested_network_mode" in ('on', 'off', 'unknown'))
    and ("__new_capture_attempt"."target_region" is null or length("__new_capture_attempt"."target_region") = 2)
    and ("__new_capture_attempt"."observed_region" is null or "__new_capture_attempt"."observed_region" = 'unknown' or length("__new_capture_attempt"."observed_region") = 2)
    and ("__new_capture_attempt"."new_session" is null or "__new_capture_attempt"."new_session" in ('true', 'false', 'unknown'))
    and ("__new_capture_attempt"."product_mode" is null or "__new_capture_attempt"."product_mode" in ('true', 'false', 'unknown'))
    and ("__new_capture_attempt"."observation_id" is null or (length("__new_capture_attempt"."observation_id") = 36 and "__new_capture_attempt"."confirmed" = 1 and "__new_capture_attempt"."status" in ('partial', 'preview'))))
);--> statement-breakpoint
INSERT INTO `__new_capture_attempt`("id", "sheet_id", "brand_id", "owner_id", "blocked_by", "citation_count", "status", "confirmed", "created_at", "updated_at", "prompt_id", "question_text", "answer_text", "citations_json", "citation_set_state", "locator_ref", "collector_id", "requested_network_mode", "target_region", "observed_region", "new_session", "product_mode", "observation_id") SELECT "id", "sheet_id", "brand_id", "owner_id", "blocked_by", "citation_count", "status", "confirmed", "created_at", "updated_at", NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM `capture_attempt`;--> statement-breakpoint
DROP TABLE `capture_attempt`;--> statement-breakpoint
CREATE TABLE `capture_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`blocked_by` text,
	`citation_count` integer NOT NULL,
	`status` text NOT NULL,
	`confirmed` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`prompt_id` text,
	`question_text` text,
	`answer_text` text,
	`citations_json` text,
	`citation_set_state` text,
	`locator_ref` text,
	`collector_id` text,
	`requested_network_mode` text,
	`target_region` text,
	`observed_region` text,
	`new_session` text,
	`product_mode` text,
	`observation_id` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sheet_id`) REFERENCES `capture_sheet`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `answer_observation`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "capture_attempt_state_check" CHECK("capture_attempt"."status" in ('handoff', 'partial', 'preview')
    and "capture_attempt"."confirmed" in (0, 1)
    and "capture_attempt"."citation_count" between 0 and 1000
    and (
      ("capture_attempt"."blocked_by" in ('captcha', 'login') and "capture_attempt"."status" = 'handoff' and "capture_attempt"."confirmed" = 0)
      or ("capture_attempt"."blocked_by" is null and "capture_attempt"."citation_count" = 0 and "capture_attempt"."status" = 'partial')
      or ("capture_attempt"."blocked_by" is null and "capture_attempt"."citation_count" between 1 and 1000 and "capture_attempt"."status" = 'preview')
    )
    and length("capture_attempt"."id") = 36
    and length("capture_attempt"."sheet_id") = 36
    and length("capture_attempt"."brand_id") = 36
    and length("capture_attempt"."owner_id") between 1 and 128
    and ("capture_attempt"."blocked_by" is null or length("capture_attempt"."blocked_by") between 5 and 7)
    and length("capture_attempt"."created_at") between 20 and 40
    and length("capture_attempt"."updated_at") between 20 and 40
    and ("capture_attempt"."prompt_id" is null or length("capture_attempt"."prompt_id") = 36)
    and ("capture_attempt"."citation_set_state" is null or "capture_attempt"."citation_set_state" in ('complete', 'partial', 'unsupported', 'missing'))
    and ("capture_attempt"."requested_network_mode" is null or "capture_attempt"."requested_network_mode" in ('on', 'off', 'unknown'))
    and ("capture_attempt"."target_region" is null or length("capture_attempt"."target_region") = 2)
    and ("capture_attempt"."observed_region" is null or "capture_attempt"."observed_region" = 'unknown' or length("capture_attempt"."observed_region") = 2)
    and ("capture_attempt"."new_session" is null or "capture_attempt"."new_session" in ('true', 'false', 'unknown'))
    and ("capture_attempt"."product_mode" is null or "capture_attempt"."product_mode" in ('true', 'false', 'unknown'))
    and ("capture_attempt"."observation_id" is null or (length("capture_attempt"."observation_id") = 36 and "capture_attempt"."confirmed" = 1 and "capture_attempt"."status" in ('partial', 'preview'))))
);--> statement-breakpoint
INSERT INTO `capture_attempt` SELECT * FROM `__new_capture_attempt`;--> statement-breakpoint
DROP TABLE `__new_capture_attempt`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `capture_attempt_sheet_idx` ON `capture_attempt` (`owner_id`,`sheet_id`,`created_at`,`id`);
