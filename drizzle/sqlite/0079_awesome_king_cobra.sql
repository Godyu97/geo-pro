CREATE TABLE `formal_control_page` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`page_key` text NOT NULL,
	`label` text NOT NULL,
	`registered_at` text NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `formal_observation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "formal_control_page_state_check" CHECK("formal_control_page"."label" = 'observation'
    and length(trim("formal_control_page"."page_key")) between 1 and 300
    and length("formal_control_page"."owner_id") between 1 and 128
    and length("formal_control_page"."registered_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `formal_control_page_page_uidx` ON `formal_control_page` (`observation_id`,`page_key`);--> statement-breakpoint
CREATE INDEX `formal_control_page_observation_idx` ON `formal_control_page` (`owner_id`,`observation_id`,`registered_at`,`id`);