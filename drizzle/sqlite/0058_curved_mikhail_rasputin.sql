CREATE TABLE `local_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`target_city` text NOT NULL,
	`sampled_city` text,
	`ranked` integer NOT NULL,
	`claimed_local_users` integer NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "local_observation_state_check" CHECK("local_observation"."ranked" = 0
    and "local_observation"."claimed_local_users" = 0
    and length("local_observation"."target_city") between 1 and 80
    and ("local_observation"."sampled_city" is null or length("local_observation"."sampled_city") between 1 and 80)
    and length("local_observation"."id") = 36
    and length("local_observation"."brand_id") = 36
    and length("local_observation"."owner_id") between 1 and 128
    and length("local_observation"."recorded_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `local_observation_owner_idx` ON `local_observation` (`owner_id`,`recorded_at`,`id`);