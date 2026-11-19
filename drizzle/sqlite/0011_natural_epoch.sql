PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `monitoring_slot` RENAME TO `monitoring_slot_old`;--> statement-breakpoint
ALTER TABLE `monitoring_run` RENAME TO `monitoring_run_old`;--> statement-breakpoint
CREATE TABLE `monitoring_run` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`track` text NOT NULL,
	`prompt_set_id` text NOT NULL,
	`prompt_set_version` integer NOT NULL,
	`repeat_count` integer NOT NULL,
	`question_count` integer NOT NULL,
	`natural_count` integer NOT NULL,
	`channel_count` integer NOT NULL,
	`slot_count` integer NOT NULL,
	`region` text NOT NULL,
	`language` text NOT NULL,
	`requested_network_mode` text NOT NULL,
	`currency` text,
	`upper_minor` integer,
	`estimate_high_minor` integer,
	`customer_payable_minor` integer NOT NULL,
	`status` text NOT NULL,
	`sampling_complete` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "monitoring_run_scope_check" CHECK("monitoring_run"."track" in ('model_api', 'consumer_ui')
    and "monitoring_run"."repeat_count" between 1 and 3
    and "monitoring_run"."question_count" > 0 and "monitoring_run"."natural_count" between 0 and "monitoring_run"."question_count"
    and "monitoring_run"."channel_count" > 0 and "monitoring_run"."slot_count" = "monitoring_run"."question_count" * "monitoring_run"."channel_count" * "monitoring_run"."repeat_count"
    and length("monitoring_run"."region") = 2 and length("monitoring_run"."language") between 2 and 40
    and "monitoring_run"."requested_network_mode" in ('on', 'off', 'unknown')
    and "monitoring_run"."status" in ('queued', 'running', 'paused', 'succeeded', 'partial', 'failed', 'cancelled')
    and "monitoring_run"."sampling_complete" in (0, 1) and "monitoring_run"."customer_payable_minor" = 0
    and (("monitoring_run"."status" in ('queued', 'running', 'paused') and "monitoring_run"."sampling_complete" = 0)
      or "monitoring_run"."status" in ('succeeded', 'partial', 'failed', 'cancelled'))
    and (
      ("monitoring_run"."track" = 'consumer_ui' and "monitoring_run"."currency" is null and "monitoring_run"."upper_minor" is null and "monitoring_run"."estimate_high_minor" is null)
      or ("monitoring_run"."track" = 'model_api' and "monitoring_run"."currency" is not null and length("monitoring_run"."currency") = 3
        and "monitoring_run"."upper_minor" >= 0 and "monitoring_run"."estimate_high_minor" = "monitoring_run"."upper_minor" * "monitoring_run"."slot_count")
    ))
);--> statement-breakpoint
INSERT INTO `monitoring_run` ("id", "brand_id", "owner_id", "operation_id", "fingerprint", "track", "prompt_set_id", "prompt_set_version", "repeat_count", "question_count", "natural_count", "channel_count", "slot_count", "region", "language", "requested_network_mode", "currency", "upper_minor", "estimate_high_minor", "customer_payable_minor", "status", "sampling_complete", "created_at") SELECT "id", "brand_id", "owner_id", "operation_id", "fingerprint", "track", "prompt_set_id", "prompt_set_version", "repeat_count", "question_count", "natural_count", "channel_count", "slot_count", "region", "language", "requested_network_mode", "currency", "upper_minor", "estimate_high_minor", "customer_payable_minor", "status", "sampling_complete", "created_at" FROM `monitoring_run_old`;--> statement-breakpoint
CREATE TABLE `monitoring_slot` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`question_id` text NOT NULL,
	`natural_question` integer NOT NULL,
	`channel_id` text NOT NULL,
	`channel_version` integer NOT NULL,
	`repeat_index` integer NOT NULL,
	`reservation_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`adopted_attempt_id` text,
	`late` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `monitoring_run`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "monitoring_slot_state_check" CHECK("monitoring_slot"."natural_question" in (0, 1) and "monitoring_slot"."repeat_index" between 1 and 3
    and "monitoring_slot"."channel_version" > 0 and "monitoring_slot"."late" in (0, 1)
    and "monitoring_slot"."status" in ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'reconciliation_required')
    and (("monitoring_slot"."status" = 'succeeded' and "monitoring_slot"."adopted_attempt_id" is not null)
      or ("monitoring_slot"."status" <> 'succeeded' and "monitoring_slot"."adopted_attempt_id" is null)))
);--> statement-breakpoint
INSERT INTO `monitoring_slot` ("id", "run_id", "brand_id", "question_id", "natural_question", "channel_id", "channel_version", "repeat_index", "reservation_id", "status", "created_at", "adopted_attempt_id", "late") SELECT "id", "run_id", "brand_id", "question_id", "natural_question", "channel_id", "channel_version", "repeat_index", "reservation_id", "status", "created_at", NULL, 0 FROM `monitoring_slot_old`;--> statement-breakpoint
DROP TABLE `monitoring_slot_old`;--> statement-breakpoint
DROP TABLE `monitoring_run_old`;--> statement-breakpoint
CREATE UNIQUE INDEX `monitoring_run_operation_uidx` ON `monitoring_run` (`brand_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `monitoring_run_brand_recent_idx` ON `monitoring_run` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `monitoring_slot_position_uidx` ON `monitoring_slot` (`run_id`,`question_id`,`channel_id`,`repeat_index`);--> statement-breakpoint
CREATE INDEX `monitoring_slot_brand_idx` ON `monitoring_slot` (`brand_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `monitoring_slot_reservation_idx` ON `monitoring_slot` (`brand_id`,`reservation_id`);--> statement-breakpoint
CREATE TABLE `monitoring_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`run_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`kind` text NOT NULL,
	`ordinal` integer NOT NULL,
	`transport` text NOT NULL,
	`synthetic` integer NOT NULL,
	`disposition` text NOT NULL,
	`raw_text` text,
	`currency` text,
	`upper_minor` integer,
	`actual_minor` integer,
	`cost_state` text NOT NULL,
	`quota_attempt_id` text,
	`late` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `monitoring_slot`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "monitoring_attempt_state_check" CHECK("monitoring_attempt"."ordinal" between 1 and 20 and "monitoring_attempt"."synthetic" in (0, 1) and "monitoring_attempt"."late" in (0, 1)
    and "monitoring_attempt"."transport" in ('isolated', 'official_api')
    and (("monitoring_attempt"."transport" = 'isolated' and "monitoring_attempt"."synthetic" = 1) or ("monitoring_attempt"."transport" = 'official_api' and "monitoring_attempt"."synthetic" = 0))
    and ("monitoring_attempt"."currency" is null or length("monitoring_attempt"."currency") = 3)
    and ("monitoring_attempt"."upper_minor" is null or "monitoring_attempt"."upper_minor" >= 0)
    and (
      ("monitoring_attempt"."cost_state" in ('none', 'pending', 'unknown') and "monitoring_attempt"."actual_minor" is null)
      or ("monitoring_attempt"."cost_state" = 'known' and "monitoring_attempt"."actual_minor" is not null and "monitoring_attempt"."actual_minor" >= 0)
    )
    and (
      ("monitoring_attempt"."kind" = 'sampling' and "monitoring_attempt"."ordinal" <= 3 and "monitoring_attempt"."disposition" in ('pending', 'adopted', 'safe_failure', 'unknown', 'late'))
      or ("monitoring_attempt"."kind" = 'analysis' and "monitoring_attempt"."disposition" = 'analysis_reuse' and "monitoring_attempt"."cost_state" = 'none')
    ))
);--> statement-breakpoint
CREATE UNIQUE INDEX `monitoring_attempt_ordinal_uidx` ON `monitoring_attempt` (`slot_id`,`kind`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `monitoring_attempt_adopted_uidx` ON `monitoring_attempt` (`slot_id`) WHERE "monitoring_attempt"."disposition" = 'adopted';--> statement-breakpoint
CREATE INDEX `monitoring_attempt_run_idx` ON `monitoring_attempt` (`run_id`,`slot_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `monitoring_attempt_brand_idx` ON `monitoring_attempt` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `quota_reservation_brand_recent_idx` ON `quota_reservation` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
