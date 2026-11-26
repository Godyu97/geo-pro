PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sampling_due_run` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`plan_version` integer NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`window_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`timezone` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`monitoring_run_id` text,
	`charged_minor` integer NOT NULL,
	`prompt_ids_json` text,
	`created_at` text NOT NULL,
	`prompt_set_id` text,
	`prompt_set_version` integer,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `sampling_slot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitoring_run_id`) REFERENCES `monitoring_run`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sampling_due_run_state_check" CHECK("__new_sampling_due_run"."plan_version" > 0
    and "__new_sampling_due_run"."kind" in ('official', 'manual')
    and "__new_sampling_due_run"."status" in ('reserved', 'accepted', 'sheet')
    and "__new_sampling_due_run"."charged_minor" >= 0
    and length("__new_sampling_due_run"."window_id") = 10
    and length("__new_sampling_due_run"."timezone") between 1 and 64
    and length("__new_sampling_due_run"."channel_id") between 1 and 64
    and length("__new_sampling_due_run"."owner_id") between 1 and 128
    and length("__new_sampling_due_run"."created_at") between 20 and 40
    and (
      ("__new_sampling_due_run"."kind" = 'manual' and "__new_sampling_due_run"."status" = 'sheet'
        and "__new_sampling_due_run"."monitoring_run_id" is null and "__new_sampling_due_run"."charged_minor" = 0
        and "__new_sampling_due_run"."prompt_ids_json" is not null and length("__new_sampling_due_run"."prompt_ids_json") between 38 and 2000
        and (
          ("__new_sampling_due_run"."prompt_set_id" is null and "__new_sampling_due_run"."prompt_set_version" is null)
          or (length("__new_sampling_due_run"."prompt_set_id") = 36 and "__new_sampling_due_run"."prompt_set_version" > 0)
        ))
      or ("__new_sampling_due_run"."kind" = 'official' and "__new_sampling_due_run"."status" = 'reserved'
        and "__new_sampling_due_run"."monitoring_run_id" is null and "__new_sampling_due_run"."charged_minor" = 0
        and "__new_sampling_due_run"."prompt_ids_json" is null and "__new_sampling_due_run"."prompt_set_id" is null and "__new_sampling_due_run"."prompt_set_version" is null)
      or ("__new_sampling_due_run"."kind" = 'official' and "__new_sampling_due_run"."status" = 'accepted'
        and "__new_sampling_due_run"."monitoring_run_id" is not null
        and "__new_sampling_due_run"."prompt_ids_json" is null and "__new_sampling_due_run"."prompt_set_id" is null and "__new_sampling_due_run"."prompt_set_version" is null)
    ))
);
--> statement-breakpoint
INSERT INTO `__new_sampling_due_run`("id", "plan_id", "plan_version", "brand_id", "owner_id", "channel_id", "window_id", "slot_id", "timezone", "kind", "status", "monitoring_run_id", "charged_minor", "prompt_ids_json", "created_at", "prompt_set_id", "prompt_set_version") SELECT "id", "plan_id", "plan_version", "brand_id", "owner_id", "channel_id", "window_id", "slot_id", "timezone", "kind", "status", "monitoring_run_id", "charged_minor", "prompt_ids_json", "created_at", NULL, NULL FROM `sampling_due_run`;--> statement-breakpoint
DROP TABLE `sampling_due_run`;--> statement-breakpoint
CREATE TABLE `sampling_due_run` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`plan_version` integer NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`window_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`timezone` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`monitoring_run_id` text,
	`charged_minor` integer NOT NULL,
	`prompt_ids_json` text,
	`created_at` text NOT NULL,
	`prompt_set_id` text,
	`prompt_set_version` integer,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `sampling_slot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitoring_run_id`) REFERENCES `monitoring_run`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sampling_due_run_state_check" CHECK("sampling_due_run"."plan_version" > 0
    and "sampling_due_run"."kind" in ('official', 'manual')
    and "sampling_due_run"."status" in ('reserved', 'accepted', 'sheet')
    and "sampling_due_run"."charged_minor" >= 0
    and length("sampling_due_run"."window_id") = 10
    and length("sampling_due_run"."timezone") between 1 and 64
    and length("sampling_due_run"."channel_id") between 1 and 64
    and length("sampling_due_run"."owner_id") between 1 and 128
    and length("sampling_due_run"."created_at") between 20 and 40
    and (
      ("sampling_due_run"."kind" = 'manual' and "sampling_due_run"."status" = 'sheet'
        and "sampling_due_run"."monitoring_run_id" is null and "sampling_due_run"."charged_minor" = 0
        and "sampling_due_run"."prompt_ids_json" is not null and length("sampling_due_run"."prompt_ids_json") between 38 and 2000
        and (
          ("sampling_due_run"."prompt_set_id" is null and "sampling_due_run"."prompt_set_version" is null)
          or (length("sampling_due_run"."prompt_set_id") = 36 and "sampling_due_run"."prompt_set_version" > 0)
        ))
      or ("sampling_due_run"."kind" = 'official' and "sampling_due_run"."status" = 'reserved'
        and "sampling_due_run"."monitoring_run_id" is null and "sampling_due_run"."charged_minor" = 0
        and "sampling_due_run"."prompt_ids_json" is null and "sampling_due_run"."prompt_set_id" is null and "sampling_due_run"."prompt_set_version" is null)
      or ("sampling_due_run"."kind" = 'official' and "sampling_due_run"."status" = 'accepted'
        and "sampling_due_run"."monitoring_run_id" is not null
        and "sampling_due_run"."prompt_ids_json" is null and "sampling_due_run"."prompt_set_id" is null and "sampling_due_run"."prompt_set_version" is null)
    ))
);
--> statement-breakpoint
INSERT INTO `sampling_due_run`("id", "plan_id", "plan_version", "brand_id", "owner_id", "channel_id", "window_id", "slot_id", "timezone", "kind", "status", "monitoring_run_id", "charged_minor", "prompt_ids_json", "created_at", "prompt_set_id", "prompt_set_version") SELECT "id", "plan_id", "plan_version", "brand_id", "owner_id", "channel_id", "window_id", "slot_id", "timezone", "kind", "status", "monitoring_run_id", "charged_minor", "prompt_ids_json", "created_at", "prompt_set_id", "prompt_set_version" FROM `__new_sampling_due_run`;--> statement-breakpoint
DROP TABLE `__new_sampling_due_run`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `sampling_due_run_slot_uidx` ON `sampling_due_run` (`plan_id`,`channel_id`,`window_id`,`slot_id`);--> statement-breakpoint
CREATE INDEX `sampling_due_run_owner_idx` ON `sampling_due_run` (`owner_id`,`plan_id`,`window_id`,`id`);