PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `user_data_export_rebuild` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`locale` text NOT NULL,
	`requested` integer NOT NULL,
	`included` integer NOT NULL,
	`fingerprint` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `user_data_export_rebuild` (`owner_id`, `id`, `locale`, `requested`, `included`, `fingerprint`, `created_at`) SELECT `owner_id`, `id`, `locale`, `requested`, `included`, `fingerprint`, `created_at` FROM `user_data_export`;--> statement-breakpoint
DROP TABLE `user_data_export`;--> statement-breakpoint
CREATE TABLE `user_data_export` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`locale` text NOT NULL,
	`requested` integer NOT NULL,
	`included` integer NOT NULL,
	`fingerprint` text,
	`created_at` text NOT NULL,
	`object_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_data_export_locale_check" CHECK("user_data_export"."locale" in ('zh-CN', 'en')),
	CONSTRAINT "user_data_export_scope_check" CHECK("user_data_export"."requested" between 1 and 127 and "user_data_export"."included" between 0 and 127 and ("user_data_export"."included" & "user_data_export"."requested") = "user_data_export"."included"),
	CONSTRAINT "user_data_export_fingerprint_check" CHECK((
      "user_data_export"."included" = 0 and "user_data_export"."fingerprint" is null and "user_data_export"."object_id" is null
    ) or (
      "user_data_export"."included" <> 0 and "user_data_export"."fingerprint" is not null and length("user_data_export"."fingerprint") = 64
      and ("user_data_export"."object_id" is null or length("user_data_export"."object_id") = 36)
    ))
);
--> statement-breakpoint
INSERT INTO `user_data_export` (`owner_id`, `id`, `locale`, `requested`, `included`, `fingerprint`, `created_at`, `object_id`) SELECT `owner_id`, `id`, `locale`, `requested`, `included`, `fingerprint`, `created_at`, NULL FROM `user_data_export_rebuild`;--> statement-breakpoint
DROP TABLE `user_data_export_rebuild`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `user_data_export_object_uidx` ON `user_data_export` (`object_id`) WHERE "user_data_export"."object_id" is not null;
