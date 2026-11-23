CREATE TABLE `external_action` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`confirmed` integer NOT NULL,
	`status` text NOT NULL,
	`receipt_kind` text,
	`effective_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `external_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_action_state_check" CHECK("external_action"."confirmed" in (0, 1)
    and "external_action"."status" in ('confirmed', 'acknowledged', 'unknown', 'failed', 'reconciled')
    and ("external_action"."receipt_kind" is null or "external_action"."receipt_kind" in ('draft_created', 'public_url'))
    and length("external_action"."id") = 36
    and length("external_action"."connection_id") = 36
    and length("external_action"."brand_id") = 36
    and length("external_action"."owner_id") between 1 and 128
    and length("external_action"."idempotency_key") between 8 and 80
    and length("external_action"."created_at") between 20 and 40
    and length("external_action"."updated_at") between 20 and 40
    and (
      ("external_action"."status" = 'failed' and "external_action"."receipt_kind" is null and "external_action"."effective_at" is null)
      or ("external_action"."status" in ('confirmed', 'unknown') and "external_action"."confirmed" = 1 and "external_action"."receipt_kind" is null and "external_action"."effective_at" is null)
      or (
        "external_action"."status" in ('acknowledged', 'reconciled')
        and "external_action"."confirmed" = 1
        and (
          ("external_action"."receipt_kind" is null and "external_action"."effective_at" is null)
          or ("external_action"."receipt_kind" = 'draft_created' and "external_action"."effective_at" is null)
          or ("external_action"."receipt_kind" = 'public_url' and "external_action"."effective_at" is not null and length("external_action"."effective_at") between 20 and 40)
        )
      )
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_action_key_uidx` ON `external_action` (`connection_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `external_action_connection_idx` ON `external_action` (`owner_id`,`connection_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `external_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`label` text NOT NULL,
	`can_read` integer NOT NULL,
	`can_draft` integer NOT NULL,
	`can_publish` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_connection_state_check" CHECK("external_connection"."status" in ('pending', 'verified', 'revoked')
    and "external_connection"."can_read" in (0, 1)
    and "external_connection"."can_draft" in (0, 1)
    and "external_connection"."can_publish" in (0, 1)
    and length("external_connection"."id") = 36
    and length("external_connection"."brand_id") = 36
    and length("external_connection"."owner_id") between 1 and 128
    and length("external_connection"."label") between 1 and 80
    and length("external_connection"."created_at") between 20 and 40
    and length("external_connection"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `external_connection_owner_idx` ON `external_connection` (`owner_id`,`brand_id`,`created_at`,`id`);