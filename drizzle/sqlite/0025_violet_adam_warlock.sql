PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `report_snapshot` RENAME TO `report_snapshot_legacy`;--> statement-breakpoint
CREATE TABLE `report_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`retest_id` text NOT NULL,
	`status` text NOT NULL,
	`grade` text NOT NULL,
	`intent` text NOT NULL,
	`loop_completed` integer NOT NULL,
	`predecessor_id` text,
	`entity_version` integer NOT NULL,
	`timezone` text NOT NULL,
	`locale` text NOT NULL,
	`source_missing` integer NOT NULL,
	`json_bytes` text NOT NULL,
	`html_bytes` text NOT NULL,
	`json_sha256` text NOT NULL,
	`html_sha256` text NOT NULL,
	`operation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`html_object_id` text,
	`json_object_id` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`retest_id`) REFERENCES `report_retest`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "report_snapshot_state_check" CHECK("report_snapshot"."status" in ('created', 'superseded')
    and "report_snapshot"."grade" in ('exploratory', 'incomparable')
    and "report_snapshot"."intent" in ('business_loop', 'diagnostic')
    and "report_snapshot"."loop_completed" in (0, 1)
    and "report_snapshot"."source_missing" in (0, 1)
    and "report_snapshot"."entity_version" > 0
    and length("report_snapshot"."json_sha256") = 64
    and length("report_snapshot"."html_sha256") = 64
    and (
      ("report_snapshot"."html_object_id" is null and "report_snapshot"."json_object_id" is null
        and length("report_snapshot"."html_bytes") > 1 and length("report_snapshot"."json_bytes") > 1)
      or ("report_snapshot"."html_object_id" is not null and "report_snapshot"."json_object_id" is not null
        and "report_snapshot"."html_object_id" <> "report_snapshot"."json_object_id"
        and length("report_snapshot"."html_bytes") = 0 and length("report_snapshot"."json_bytes") = 0)
    ))
);--> statement-breakpoint
INSERT INTO `report_snapshot` ("id", "brand_id", "owner_id", "retest_id", "status", "grade", "intent", "loop_completed", "predecessor_id", "entity_version", "timezone", "locale", "source_missing", "json_bytes", "html_bytes", "json_sha256", "html_sha256", "operation_id", "created_at", "html_object_id", "json_object_id") SELECT "id", "brand_id", "owner_id", "retest_id", "status", "grade", "intent", "loop_completed", "predecessor_id", "entity_version", "timezone", "locale", "source_missing", "json_bytes", "html_bytes", "json_sha256", "html_sha256", "operation_id", "created_at", NULL, NULL FROM `report_snapshot_legacy`;--> statement-breakpoint
DROP TABLE `report_snapshot_legacy`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `report_snapshot_operation_uidx` ON `report_snapshot` (`brand_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `report_snapshot_brand_idx` ON `report_snapshot` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `report_snapshot_owner_idx` ON `report_snapshot` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `report_snapshot_predecessor_idx` ON `report_snapshot` (`predecessor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `report_snapshot_html_object_uidx` ON `report_snapshot` (`html_object_id`) WHERE "report_snapshot"."html_object_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `report_snapshot_json_object_uidx` ON `report_snapshot` (`json_object_id`) WHERE "report_snapshot"."json_object_id" is not null;
