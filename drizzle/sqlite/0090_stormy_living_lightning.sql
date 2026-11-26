PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_formal_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`frozen_set_id` text NOT NULL,
	`effective_on` text NOT NULL,
	`frozen_non_brand_count` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`stop_reason` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "formal_observation_state_check" CHECK("__new_formal_observation"."status" in ('observing', 'checkpoint_due', 'stopped')
    and (
      ("__new_formal_observation"."status" <> 'stopped' and "__new_formal_observation"."stop_reason" is null)
      or ("__new_formal_observation"."status" = 'stopped' and "__new_formal_observation"."stop_reason" is not null and length(trim("__new_formal_observation"."stop_reason")) between 1 and 400)
    )
    and "__new_formal_observation"."frozen_non_brand_count" between 1 and 500
    and length("__new_formal_observation"."frozen_set_id") between 1 and 64
    and length("__new_formal_observation"."effective_on") = 10
    and length("__new_formal_observation"."owner_id") between 1 and 128
    and length("__new_formal_observation"."created_at") between 20 and 40
    and length("__new_formal_observation"."updated_at") between 20 and 40)
);
--> statement-breakpoint
INSERT INTO `__new_formal_observation`("id", "brand_id", "owner_id", "frozen_set_id", "effective_on", "frozen_non_brand_count", "status", "created_at", "updated_at", "stop_reason") SELECT "id", "brand_id", "owner_id", "frozen_set_id", "effective_on", "frozen_non_brand_count", "status", "created_at", "updated_at", NULL FROM `formal_observation`;--> statement-breakpoint
DROP TABLE `formal_observation`;--> statement-breakpoint
CREATE TABLE `formal_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`frozen_set_id` text NOT NULL,
	`effective_on` text NOT NULL,
	`frozen_non_brand_count` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`stop_reason` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "formal_observation_state_check" CHECK("formal_observation"."status" in ('observing', 'checkpoint_due', 'stopped')
    and (
      ("formal_observation"."status" <> 'stopped' and "formal_observation"."stop_reason" is null)
      or ("formal_observation"."status" = 'stopped' and "formal_observation"."stop_reason" is not null and length(trim("formal_observation"."stop_reason")) between 1 and 400)
    )
    and "formal_observation"."frozen_non_brand_count" between 1 and 500
    and length("formal_observation"."frozen_set_id") between 1 and 64
    and length("formal_observation"."effective_on") = 10
    and length("formal_observation"."owner_id") between 1 and 128
    and length("formal_observation"."created_at") between 20 and 40
    and length("formal_observation"."updated_at") between 20 and 40)
);
--> statement-breakpoint
INSERT INTO `formal_observation`("id", "brand_id", "owner_id", "frozen_set_id", "effective_on", "frozen_non_brand_count", "status", "created_at", "updated_at", "stop_reason") SELECT "id", "brand_id", "owner_id", "frozen_set_id", "effective_on", "frozen_non_brand_count", "status", "created_at", "updated_at", "stop_reason" FROM `__new_formal_observation`;--> statement-breakpoint
DROP TABLE `__new_formal_observation`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `formal_observation_owner_idx` ON `formal_observation` (`owner_id`,`brand_id`,`created_at`,`id`);