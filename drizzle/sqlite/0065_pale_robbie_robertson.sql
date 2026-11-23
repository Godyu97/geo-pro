PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `answer_observation` RENAME TO `__old_answer_observation`;--> statement-breakpoint
ALTER TABLE `answer_analysis_draft` RENAME TO `__old_answer_analysis_draft`;--> statement-breakpoint
ALTER TABLE `answer_analysis_version` RENAME TO `__old_answer_analysis_version`;--> statement-breakpoint
ALTER TABLE `answer_citation` RENAME TO `__old_answer_citation`;--> statement-breakpoint
ALTER TABLE `competitor_mention` RENAME TO `__old_competitor_mention`;--> statement-breakpoint
ALTER TABLE `entity_correction` RENAME TO `__old_entity_correction`;--> statement-breakpoint
ALTER TABLE `entity_disambiguation` RENAME TO `__old_entity_disambiguation`;--> statement-breakpoint
ALTER TABLE `source_inspection` RENAME TO `__old_source_inspection`;--> statement-breakpoint
CREATE TABLE `answer_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`slot_id` text,
	`attempt_id` text,
	`source_mode` text NOT NULL,
	`capture_method` text NOT NULL,
	`question_text` text NOT NULL,
	`answer_text` text NOT NULL,
	`fingerprint` text NOT NULL,
	`captured_at` text NOT NULL,
	`region` text NOT NULL,
	`language` text NOT NULL,
	`requested_network_mode` text NOT NULL,
	`entity_version` integer NOT NULL,
	`citation_set_state` text NOT NULL,
	`evidence_state` text NOT NULL,
	`locator_ref` text,
	`collector_id` text,
	`missing_reason` text,
	`created_at` text NOT NULL,
	`target_region` text NOT NULL,
	`observed_region` text DEFAULT 'unknown' NOT NULL,
	`new_session` text DEFAULT 'unknown' NOT NULL,
	`product_mode` text DEFAULT 'unknown' NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `monitoring_slot`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`attempt_id`) REFERENCES `monitoring_attempt`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "answer_observation_state_check" CHECK("answer_observation"."source_mode" in ('model_api', 'consumer_ui')
    and "answer_observation"."capture_method" in ('official_api', 'manual', 'assisted', 'isolated')
    and "answer_observation"."citation_set_state" in ('complete', 'partial', 'unsupported', 'missing')
    and "answer_observation"."evidence_state" in ('draft_evidence', 'complete', 'incomplete', 'contested')
    and "answer_observation"."entity_version" > 0 and length("answer_observation"."fingerprint") = 64
    and length("answer_observation"."region") = 2 and length("answer_observation"."language") between 2 and 40
    and "answer_observation"."requested_network_mode" in ('on', 'off', 'unknown')
    and length("answer_observation"."target_region") = 2
    and ("answer_observation"."observed_region" = 'unknown' or length("answer_observation"."observed_region") = 2)
    and "answer_observation"."new_session" in ('true', 'false', 'unknown')
    and "answer_observation"."product_mode" in ('true', 'false', 'unknown')
    and (
      ("answer_observation"."evidence_state" = 'draft_evidence')
      or ("answer_observation"."evidence_state" in ('complete', 'incomplete', 'contested') and length("answer_observation"."answer_text") > 0)
    )
    and (
      ("answer_observation"."source_mode" = 'consumer_ui' and "answer_observation"."capture_method" in ('manual', 'assisted'))
      or ("answer_observation"."source_mode" = 'model_api' and "answer_observation"."capture_method" in ('official_api', 'isolated', 'assisted'))
    ))
);--> statement-breakpoint
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
);--> statement-breakpoint
CREATE TABLE `answer_analysis_version` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`version` integer NOT NULL,
	`entity_version` integer NOT NULL,
	`rule_version` text NOT NULL,
	`mentioned` text NOT NULL,
	`recommended` text NOT NULL,
	`official_site_cited` text NOT NULL,
	`evidence_span` text,
	`status` text NOT NULL,
	`revised_from` text,
	`reason` text,
	`reviewer_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `answer_observation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "answer_analysis_state_check" CHECK("answer_analysis_version"."version" > 0 and "answer_analysis_version"."entity_version" > 0
    and "answer_analysis_version"."mentioned" in ('true', 'false', 'unknown')
    and "answer_analysis_version"."recommended" in ('true', 'false', 'unknown')
    and "answer_analysis_version"."official_site_cited" in ('true', 'false', 'unknown')
    and "answer_analysis_version"."status" in ('pending', 'classified', 'needs_review', 'revised')
    and ("answer_analysis_version"."revised_from" is null or "answer_analysis_version"."revised_from" <> "answer_analysis_version"."id"))
);--> statement-breakpoint
CREATE TABLE `answer_citation` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`raw_url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`citation_origin` text NOT NULL,
	`position_label` text,
	`ownership` text NOT NULL,
	`page_status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `answer_observation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "answer_citation_state_check" CHECK("answer_citation"."citation_origin" in ('provider_native', 'consumer_visible', 'search_candidate', 'analyst_found', 'custom_pipeline')
    and "answer_citation"."ownership" in ('owned_domain', 'owned_account', 'competitor', 'third_party', 'unknown')
    and "answer_citation"."page_status" in ('unknown', 'reachable', 'restricted', 'not_applicable'))
);--> statement-breakpoint
CREATE TABLE `competitor_mention` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`set_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`competitor_label` text NOT NULL,
	`ordered` integer NOT NULL,
	`position` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_id`) REFERENCES `competitor_set`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `answer_observation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "competitor_mention_check" CHECK("competitor_mention"."ordered" in (0, 1)
    and length("competitor_mention"."competitor_label") between 1 and 80
    and (
      ("competitor_mention"."ordered" = 1 and "competitor_mention"."position" > 0)
      or ("competitor_mention"."ordered" = 0 and "competitor_mention"."position" is null)
    ))
);--> statement-breakpoint
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
);--> statement-breakpoint
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
);--> statement-breakpoint
CREATE TABLE `source_inspection` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`citation_id` text NOT NULL,
	`state` text NOT NULL,
	`support` text NOT NULL,
	`page_live` integer NOT NULL,
	`readable` integer NOT NULL,
	`author_known` integer NOT NULL,
	`supports_brand` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`citation_id`) REFERENCES `answer_citation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_inspection_check" CHECK("source_inspection"."state" in ('observed', 'resolved', 'limited', 'unknown')
    and "source_inspection"."support" in ('supports', 'unknown')
    and "source_inspection"."page_live" in (0, 1)
    and "source_inspection"."readable" in (0, 1)
    and "source_inspection"."author_known" in (0, 1)
    and "source_inspection"."supports_brand" in (0, 1)
    and ("source_inspection"."support" = 'unknown' or ("source_inspection"."page_live" = 1 and "source_inspection"."readable" = 1 and "source_inspection"."supports_brand" = 1)))
);--> statement-breakpoint
INSERT INTO `answer_observation`(`id`, `brand_id`, `owner_id`, `slot_id`, `attempt_id`, `source_mode`, `capture_method`, `question_text`, `answer_text`, `fingerprint`, `captured_at`, `region`, `language`, `requested_network_mode`, `entity_version`, `citation_set_state`, `evidence_state`, `locator_ref`, `collector_id`, `missing_reason`, `created_at`, `target_region`, `observed_region`, `new_session`, `product_mode`) SELECT `id`, `brand_id`, `owner_id`, `slot_id`, `attempt_id`, `source_mode`, `capture_method`, `question_text`, `answer_text`, `fingerprint`, `captured_at`, `region`, `language`, `requested_network_mode`, `entity_version`, `citation_set_state`, `evidence_state`, `locator_ref`, `collector_id`, `missing_reason`, `created_at`, `region`, 'unknown', 'unknown', 'unknown' FROM `__old_answer_observation`;--> statement-breakpoint
INSERT INTO `answer_analysis_draft` SELECT * FROM `__old_answer_analysis_draft`;--> statement-breakpoint
INSERT INTO `answer_analysis_version` SELECT * FROM `__old_answer_analysis_version`;--> statement-breakpoint
INSERT INTO `answer_citation` SELECT * FROM `__old_answer_citation`;--> statement-breakpoint
INSERT INTO `competitor_mention` SELECT * FROM `__old_competitor_mention`;--> statement-breakpoint
INSERT INTO `entity_correction` SELECT * FROM `__old_entity_correction`;--> statement-breakpoint
INSERT INTO `entity_disambiguation` SELECT * FROM `__old_entity_disambiguation`;--> statement-breakpoint
INSERT INTO `source_inspection` SELECT * FROM `__old_source_inspection`;--> statement-breakpoint
DROP TABLE `__old_source_inspection`;--> statement-breakpoint
DROP TABLE `__old_entity_disambiguation`;--> statement-breakpoint
DROP TABLE `__old_entity_correction`;--> statement-breakpoint
DROP TABLE `__old_competitor_mention`;--> statement-breakpoint
DROP TABLE `__old_answer_citation`;--> statement-breakpoint
DROP TABLE `__old_answer_analysis_version`;--> statement-breakpoint
DROP TABLE `__old_answer_analysis_draft`;--> statement-breakpoint
DROP TABLE `__old_answer_observation`;--> statement-breakpoint
CREATE INDEX `answer_analysis_draft_observation_idx` ON `answer_analysis_draft` (`observation_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `answer_analysis_version_uidx` ON `answer_analysis_version` (`observation_id`,`version`);--> statement-breakpoint
CREATE INDEX `answer_analysis_brand_idx` ON `answer_analysis_version` (`brand_id`,`observation_id`,`version`);--> statement-breakpoint
CREATE INDEX `answer_citation_observation_idx` ON `answer_citation` (`observation_id`,`id`);--> statement-breakpoint
CREATE INDEX `answer_citation_brand_idx` ON `answer_citation` (`brand_id`,`observation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `answer_observation_slot_uidx` ON `answer_observation` (`slot_id`) WHERE "answer_observation"."slot_id" is not null and "answer_observation"."evidence_state" in ('complete', 'incomplete', 'contested');--> statement-breakpoint
CREATE INDEX `answer_observation_brand_idx` ON `answer_observation` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `answer_observation_owner_idx` ON `answer_observation` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `competitor_mention_once_uidx` ON `competitor_mention` (`set_id`,`observation_id`,`competitor_label`);--> statement-breakpoint
CREATE INDEX `competitor_mention_set_idx` ON `competitor_mention` (`brand_id`,`set_id`,`observation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_inspection_citation_uidx` ON `source_inspection` (`citation_id`);--> statement-breakpoint
CREATE INDEX `source_inspection_brand_idx` ON `source_inspection` (`brand_id`,`citation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_correction_event_uidx` ON `entity_correction` (`observation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `entity_correction_owner_idx` ON `entity_correction` (`owner_id`,`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_disambiguation_prior_uidx` ON `entity_disambiguation` (`prior_analysis_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_disambiguation_next_uidx` ON `entity_disambiguation` (`next_analysis_id`);--> statement-breakpoint
CREATE INDEX `entity_disambiguation_owner_idx` ON `entity_disambiguation` (`owner_id`,`brand_id`,`created_at`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
