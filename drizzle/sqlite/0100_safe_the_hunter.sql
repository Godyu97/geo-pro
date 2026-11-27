PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_whitelabel_share` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`track` text NOT NULL,
	`sample_size` integer NOT NULL,
	`grade` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked` integer NOT NULL,
	`created_at` text NOT NULL,
	`snapshot_id` text,
	`limitations_json` text,
	`sample_summary_json` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `report_snapshot`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "whitelabel_share_state_check" CHECK("__new_whitelabel_share"."revoked" in (0, 1)
    and "__new_whitelabel_share"."sample_size" between 0 and 2000000000
    and length("__new_whitelabel_share"."track") between 1 and 64
    and "__new_whitelabel_share"."track" not glob '*[^a-z0-9_]*'
    and length("__new_whitelabel_share"."grade") between 1 and 32
    and "__new_whitelabel_share"."grade" not glob '*[^a-z0-9_]*'
    and length("__new_whitelabel_share"."id") = 36
    and length("__new_whitelabel_share"."brand_id") = 36
    and length("__new_whitelabel_share"."owner_id") between 1 and 128
    and ("__new_whitelabel_share"."snapshot_id" is null or length("__new_whitelabel_share"."snapshot_id") = 36)
    and ("__new_whitelabel_share"."limitations_json" is null or length("__new_whitelabel_share"."limitations_json") >= 2)
    and ("__new_whitelabel_share"."sample_summary_json" is null or length("__new_whitelabel_share"."sample_summary_json") >= 2)
    and length("__new_whitelabel_share"."expires_at") between 20 and 40
    and length("__new_whitelabel_share"."created_at") between 20 and 40)
);
--> statement-breakpoint
INSERT INTO `__new_whitelabel_share`("id", "brand_id", "owner_id", "track", "sample_size", "grade", "expires_at", "revoked", "created_at", "snapshot_id", "limitations_json", "sample_summary_json") SELECT "id", "brand_id", "owner_id", "track", "sample_size", "grade", "expires_at", "revoked", "created_at", NULL, NULL, NULL FROM `whitelabel_share`;--> statement-breakpoint
DROP TABLE `whitelabel_share`;--> statement-breakpoint
CREATE TABLE `whitelabel_share` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`track` text NOT NULL,
	`sample_size` integer NOT NULL,
	`grade` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked` integer NOT NULL,
	`created_at` text NOT NULL,
	`snapshot_id` text,
	`limitations_json` text,
	`sample_summary_json` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `report_snapshot`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "whitelabel_share_state_check" CHECK("whitelabel_share"."revoked" in (0, 1)
    and "whitelabel_share"."sample_size" between 0 and 2000000000
    and length("whitelabel_share"."track") between 1 and 64
    and "whitelabel_share"."track" not glob '*[^a-z0-9_]*'
    and length("whitelabel_share"."grade") between 1 and 32
    and "whitelabel_share"."grade" not glob '*[^a-z0-9_]*'
    and length("whitelabel_share"."id") = 36
    and length("whitelabel_share"."brand_id") = 36
    and length("whitelabel_share"."owner_id") between 1 and 128
    and ("whitelabel_share"."snapshot_id" is null or length("whitelabel_share"."snapshot_id") = 36)
    and ("whitelabel_share"."limitations_json" is null or length("whitelabel_share"."limitations_json") >= 2)
    and ("whitelabel_share"."sample_summary_json" is null or length("whitelabel_share"."sample_summary_json") >= 2)
    and length("whitelabel_share"."expires_at") between 20 and 40
    and length("whitelabel_share"."created_at") between 20 and 40)
);--> statement-breakpoint
INSERT INTO `whitelabel_share` SELECT * FROM `__new_whitelabel_share`;--> statement-breakpoint
DROP TABLE `__new_whitelabel_share`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `whitelabel_share_owner_idx` ON `whitelabel_share` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `whitelabel_share_brand_idx` ON `whitelabel_share` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `whitelabel_share_snapshot_idx` ON `whitelabel_share` (`snapshot_id`);
