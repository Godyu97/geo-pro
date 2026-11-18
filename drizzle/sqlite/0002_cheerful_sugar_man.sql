CREATE TABLE `user_data_export` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`locale` text NOT NULL,
	`requested` integer NOT NULL,
	`included` integer NOT NULL,
	`fingerprint` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_data_export_locale_check" CHECK("user_data_export"."locale" in ('zh-CN', 'en')),
	CONSTRAINT "user_data_export_scope_check" CHECK("user_data_export"."requested" between 1 and 3 and "user_data_export"."included" between 0 and 3 and ("user_data_export"."included" & "user_data_export"."requested") = "user_data_export"."included"),
	CONSTRAINT "user_data_export_fingerprint_check" CHECK(("user_data_export"."included" = 0 and "user_data_export"."fingerprint" is null) or ("user_data_export"."included" <> 0 and "user_data_export"."fingerprint" is not null and length("user_data_export"."fingerprint") = 64))
);
