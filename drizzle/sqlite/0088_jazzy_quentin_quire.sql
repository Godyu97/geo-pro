PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_data_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text NOT NULL,
	`field_count` integer NOT NULL,
	`pull_attempted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_data_connection`("id", "brand_id", "owner_id", "display_name", "status", "field_count", "pull_attempted_at", "created_at", "updated_at") SELECT "id", "brand_id", "owner_id", "display_name", "status", "field_count", "pull_attempted_at", "created_at", "updated_at" FROM `data_connection`;--> statement-breakpoint
DROP TABLE `data_connection`;--> statement-breakpoint
CREATE TABLE `data_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text NOT NULL,
	`field_count` integer NOT NULL,
	`pull_attempted_at` text,
	`sync_cursor` text,
	`coverage_complete` integer,
	`sync_stopped` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "data_connection_state_check" CHECK("data_connection"."status" in ('preview', 'approved')
    and "data_connection"."field_count" between 1 and 40
    and length("data_connection"."display_name") between 1 and 80
    and length("data_connection"."id") = 36
    and length("data_connection"."brand_id") = 36
    and length("data_connection"."owner_id") between 1 and 128
    and length("data_connection"."created_at") between 20 and 40
    and length("data_connection"."updated_at") between 20 and 40
    and "data_connection"."sync_stopped" in (0, 1)
    and (
      ("data_connection"."sync_cursor" is null and "data_connection"."coverage_complete" is null)
      or (
        length("data_connection"."sync_cursor") between 1 and 64
        and substr("data_connection"."sync_cursor", 1, 1) glob '[A-Za-z0-9]'
        and "data_connection"."sync_cursor" not glob '*[^A-Za-z0-9._:-]*'
        and "data_connection"."coverage_complete" in (0, 1)
      )
    )
    and (
      ("data_connection"."status" = 'preview' and "data_connection"."pull_attempted_at" is null and "data_connection"."sync_cursor" is null and "data_connection"."sync_stopped" = 0)
      or (
        "data_connection"."status" = 'approved'
        and ("data_connection"."pull_attempted_at" is null or length("data_connection"."pull_attempted_at") between 20 and 40)
      )
    ))
);
--> statement-breakpoint
INSERT INTO `data_connection`("id", "brand_id", "owner_id", "display_name", "status", "field_count", "pull_attempted_at", "sync_cursor", "coverage_complete", "sync_stopped", "created_at", "updated_at") SELECT "id", "brand_id", "owner_id", "display_name", "status", "field_count", "pull_attempted_at", NULL, NULL, 0, "created_at", "updated_at" FROM `__new_data_connection`;--> statement-breakpoint
DROP TABLE `__new_data_connection`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `data_connection_owner_idx` ON `data_connection` (`owner_id`,`created_at`,`id`);
