CREATE TABLE `connector_event` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`event_key` text NOT NULL,
	`count` integer NOT NULL,
	`conflict` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "connector_event_state_check" CHECK("connector_event"."count" = 1
    and "connector_event"."conflict" in (0, 1)
    and length("connector_event"."event_key") between 1 and 64
    and substr("connector_event"."event_key", 1, 1) glob '[A-Za-z0-9]'
    and "connector_event"."event_key" not glob '*[^A-Za-z0-9._:-]*'
    and length("connector_event"."id") = 36
    and length("connector_event"."brand_id") = 36
    and length("connector_event"."owner_id") between 1 and 128
    and length("connector_event"."created_at") between 20 and 40
    and length("connector_event"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_event_key_uidx` ON `connector_event` (`owner_id`,`brand_id`,`event_key`);--> statement-breakpoint
CREATE INDEX `connector_event_owner_idx` ON `connector_event` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `connector_event_source` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`source` text NOT NULL,
	`payload_digest` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `connector_event`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "connector_event_source_state_check" CHECK("connector_event_source"."source" in ('csv', 'connector')
    and length("connector_event_source"."payload_digest") = 64
    and "connector_event_source"."payload_digest" not glob '*[^a-f0-9]*'
    and length("connector_event_source"."id") = 36
    and length("connector_event_source"."event_id") = 36
    and length("connector_event_source"."brand_id") = 36
    and length("connector_event_source"."owner_id") between 1 and 128
    and length("connector_event_source"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_event_source_event_uidx` ON `connector_event_source` (`event_id`,`source`);--> statement-breakpoint
CREATE INDEX `connector_event_source_owner_idx` ON `connector_event_source` (`owner_id`,`event_id`,`source`);