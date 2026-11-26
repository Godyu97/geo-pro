CREATE TABLE `data_connection_sync_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`cursor` text NOT NULL,
	`previous_cursor` text,
	`payload_digest` text NOT NULL,
	`coverage_complete` integer NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `data_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "data_connection_sync_batch_state_check" CHECK(length("data_connection_sync_batch"."id") = 36
    and length("data_connection_sync_batch"."connection_id") = 36
    and length("data_connection_sync_batch"."brand_id") = 36
    and length("data_connection_sync_batch"."owner_id") between 1 and 128
    and length("data_connection_sync_batch"."cursor") between 1 and 64
    and substr("data_connection_sync_batch"."cursor", 1, 1) glob '[A-Za-z0-9]'
    and "data_connection_sync_batch"."cursor" not glob '*[^A-Za-z0-9._:-]*'
    and ("data_connection_sync_batch"."previous_cursor" is null or (
      length("data_connection_sync_batch"."previous_cursor") between 1 and 64
      and substr("data_connection_sync_batch"."previous_cursor", 1, 1) glob '[A-Za-z0-9]'
      and "data_connection_sync_batch"."previous_cursor" not glob '*[^A-Za-z0-9._:-]*'
      and "data_connection_sync_batch"."previous_cursor" <> "data_connection_sync_batch"."cursor"
    ))
    and length("data_connection_sync_batch"."payload_digest") = 64
    and "data_connection_sync_batch"."payload_digest" not glob '*[^a-f0-9]*'
    and "data_connection_sync_batch"."coverage_complete" in (0, 1)
    and length("data_connection_sync_batch"."synced_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_connection_sync_batch_cursor_uidx` ON `data_connection_sync_batch` (`connection_id`,`cursor`);--> statement-breakpoint
CREATE INDEX `data_connection_sync_batch_owner_idx` ON `data_connection_sync_batch` (`owner_id`,`connection_id`,`synced_at`,`id`);