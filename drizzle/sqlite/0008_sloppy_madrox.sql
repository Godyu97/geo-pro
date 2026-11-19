CREATE TABLE `capability_channel` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "capability_channel_kind_check" CHECK("capability_channel"."kind" in ('consumer_ui', 'model_api', 'custom_pipeline'))
);
--> statement-breakpoint
CREATE INDEX `capability_channel_vendor_kind_idx` ON `capability_channel` (`vendor_id`,`kind`,`id`);--> statement-breakpoint
CREATE TABLE `capability_version` (
	`channel_id` text NOT NULL,
	`version` integer NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`display_name` text NOT NULL,
	`product_entry` text NOT NULL,
	`mode` text NOT NULL,
	`model_version` text NOT NULL,
	`availability` text NOT NULL,
	`search_required` integer NOT NULL,
	`citation_capability` text NOT NULL,
	`region_target` text NOT NULL,
	`region_actual` text NOT NULL,
	`limits_summary` text NOT NULL,
	`sop_summary` text NOT NULL,
	`verified_at` text,
	`expires_at` text,
	`public_visible` integer NOT NULL,
	`changed_at` text NOT NULL,
	PRIMARY KEY(`channel_id`, `version`),
	FOREIGN KEY (`channel_id`) REFERENCES `capability_channel`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "capability_version_values_check" CHECK("capability_version"."version" > 0
    and "capability_version"."status" in ('candidate', 'verified', 'degraded', 'disabled')
    and "capability_version"."reason" in ('initial-record', 'verification', 'significant-change', 'disable', 'restore', 'expiry-review')
    and "capability_version"."citation_capability" in ('complete', 'partial', 'unsupported')
    and "capability_version"."search_required" in (0, 1) and "capability_version"."public_visible" in (0, 1)
    and (
      ("capability_version"."status" = 'verified' and "capability_version"."verified_at" is not null and "capability_version"."expires_at" is not null)
      or ("capability_version"."status" <> 'verified' and "capability_version"."public_visible" = 0)
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_version_operation_unique` ON `capability_version` (`operation_id`);--> statement-breakpoint
CREATE TABLE `sampling_answer_network` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`channel_version` integer NOT NULL,
	`requested_network_mode` text NOT NULL,
	`actual_network` text NOT NULL,
	`trigger_evidence` text NOT NULL,
	`qualifies_required_search` integer NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`,`channel_version`) REFERENCES `capability_version`(`channel_id`,`version`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sampling_answer_network_values_check" CHECK("sampling_answer_network"."requested_network_mode" in ('on', 'off', 'unknown')
    and "sampling_answer_network"."actual_network" in ('true', 'false', 'unknown')
    and "sampling_answer_network"."trigger_evidence" in ('none', 'observed')
    and "sampling_answer_network"."qualifies_required_search" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `sampling_answer_network_brand_created_idx` ON `sampling_answer_network` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `sampling_answer_network_channel_version_idx` ON `sampling_answer_network` (`channel_id`,`channel_version`);