PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `competitor_mention` RENAME TO `__old_competitor_mention`;--> statement-breakpoint
CREATE TABLE `competitor_mention` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`set_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`competitor_label` text NOT NULL,
	`ordered` integer NOT NULL,
	`position` integer,
	`created_at` text NOT NULL,
	`mention_state` text DEFAULT 'true' NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_id`) REFERENCES `competitor_set`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `answer_observation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "competitor_mention_check" CHECK("competitor_mention"."ordered" in (0, 1)
    and "competitor_mention"."mention_state" in ('true', 'false', 'unknown')
    and length("competitor_mention"."competitor_label") between 1 and 80
    and (
      ("competitor_mention"."mention_state" = 'true' and (
        ("competitor_mention"."ordered" = 1 and "competitor_mention"."position" > 0)
        or ("competitor_mention"."ordered" = 0 and "competitor_mention"."position" is null)
      ))
      or ("competitor_mention"."mention_state" in ('false', 'unknown') and "competitor_mention"."position" is null)
    ))
);
--> statement-breakpoint
INSERT INTO `competitor_mention`("id", "brand_id", "owner_id", "set_id", "observation_id", "competitor_label", "ordered", "position", "created_at", "mention_state") SELECT "id", "brand_id", "owner_id", "set_id", "observation_id", "competitor_label", "ordered", "position", "created_at", "mention_state" FROM `__old_competitor_mention`;--> statement-breakpoint
DROP TABLE `__old_competitor_mention`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `competitor_mention_once_uidx` ON `competitor_mention` (`set_id`,`observation_id`,`competitor_label`);--> statement-breakpoint
CREATE INDEX `competitor_mention_set_idx` ON `competitor_mention` (`brand_id`,`set_id`,`observation_id`);