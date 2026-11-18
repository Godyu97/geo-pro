CREATE TABLE `quota_attempt` (
	`brand_id` text NOT NULL,
	`kind` text NOT NULL,
	`reservation_id` text NOT NULL,
	`id` text NOT NULL,
	`upper_minor` integer NOT NULL,
	`actual_minor` integer,
	`state` text NOT NULL,
	`started_at` text NOT NULL,
	`reconciled_at` text,
	PRIMARY KEY(`brand_id`, `kind`, `reservation_id`, `id`),
	FOREIGN KEY (`brand_id`,`kind`,`reservation_id`) REFERENCES `quota_reservation`(`brand_id`,`kind`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quota_attempt_cost_check" CHECK("quota_attempt"."upper_minor" >= 0 and (
    ("quota_attempt"."state" in ('pending', 'unknown') and "quota_attempt"."actual_minor" is null and "quota_attempt"."reconciled_at" is null) or
    ("quota_attempt"."state" = 'known' and "quota_attempt"."actual_minor" is not null and "quota_attempt"."actual_minor" >= 0 and "quota_attempt"."reconciled_at" is not null)
  ))
);
--> statement-breakpoint
CREATE TABLE `quota_grant` (
	`brand_id` text NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`count_limit` integer NOT NULL,
	`budget_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`expires_at` text NOT NULL,
	`changed_at` text NOT NULL,
	`action` text NOT NULL,
	PRIMARY KEY(`brand_id`, `kind`, `version`),
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quota_grant_limits_check" CHECK("quota_grant"."kind" in ('sampling', 'generation') and "quota_grant"."action" in ('set', 'revoke')
    and "quota_grant"."version" > 0 and "quota_grant"."count_limit" > 0 and "quota_grant"."budget_minor" >= 0 and length("quota_grant"."currency") = 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quota_grant_operation_unique` ON `quota_grant` (`brand_id`,`kind`,`operation_id`);--> statement-breakpoint
CREATE TABLE `quota_reservation` (
	`brand_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`grant_version` integer NOT NULL,
	`upper_minor` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`finalized_at` text,
	PRIMARY KEY(`brand_id`, `kind`, `id`),
	FOREIGN KEY (`brand_id`,`kind`,`grant_version`) REFERENCES `quota_grant`(`brand_id`,`kind`,`version`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quota_reservation_state_check" CHECK("quota_reservation"."upper_minor" >= 0 and (
    ("quota_reservation"."state" = 'reserved' and "quota_reservation"."finalized_at" is null) or
    ("quota_reservation"."state" in ('settled', 'released') and "quota_reservation"."finalized_at" is not null)
  ))
);
