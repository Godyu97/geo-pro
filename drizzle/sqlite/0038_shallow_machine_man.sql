CREATE TABLE `formal_checkpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`checkpoint` text NOT NULL,
	`mode` text NOT NULL,
	`comparable_count` integer NOT NULL,
	`excluded_json` text NOT NULL,
	`conclusion` text,
	`evaluated_on` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `formal_observation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "formal_checkpoint_state_check" CHECK("formal_checkpoint"."checkpoint" in ('d7', 'd14', 'd28')
    and "formal_checkpoint"."mode" in ('progress', 'formal', 'exploratory')
    and "formal_checkpoint"."comparable_count" between 0 and 500
    and length("formal_checkpoint"."excluded_json") between 2 and 4000
    and length("formal_checkpoint"."evaluated_on") = 10
    and (
      ("formal_checkpoint"."mode" = 'progress' and "formal_checkpoint"."conclusion" is null)
      or ("formal_checkpoint"."mode" in ('formal', 'exploratory') and "formal_checkpoint"."conclusion" is not null
        and length("formal_checkpoint"."conclusion") between 2 and 400)
    )
    and length("formal_checkpoint"."owner_id") between 1 and 128
    and length("formal_checkpoint"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `formal_checkpoint_observation_idx` ON `formal_checkpoint` (`owner_id`,`observation_id`,`created_at`,`id`);--> statement-breakpoint
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
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "formal_observation_state_check" CHECK("formal_observation"."status" in ('observing', 'checkpoint_due')
    and "formal_observation"."frozen_non_brand_count" between 1 and 500
    and length("formal_observation"."frozen_set_id") between 1 and 64
    and length("formal_observation"."effective_on") = 10
    and length("formal_observation"."owner_id") between 1 and 128
    and length("formal_observation"."created_at") between 20 and 40
    and length("formal_observation"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `formal_observation_owner_idx` ON `formal_observation` (`owner_id`,`brand_id`,`created_at`,`id`);