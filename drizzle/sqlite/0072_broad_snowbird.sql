CREATE TABLE `formal_confounder` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`factor` text NOT NULL,
	`note` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `formal_observation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "formal_confounder_state_check" CHECK("formal_confounder"."factor" in ('model', 'marketing', 'price')
    and length(trim("formal_confounder"."note")) between 1 and 400
    and length("formal_confounder"."owner_id") between 1 and 128
    and length("formal_confounder"."recorded_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `formal_confounder_observation_idx` ON `formal_confounder` (`owner_id`,`observation_id`,`recorded_at`,`id`);