CREATE TABLE `brand_owner_transfer` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "brand_owner_transfer_state_check" CHECK("brand_owner_transfer"."from_user_id" <> "brand_owner_transfer"."to_user_id"
    and length("brand_owner_transfer"."from_user_id") between 1 and 128
    and length("brand_owner_transfer"."to_user_id") between 1 and 128
    and length("brand_owner_transfer"."actor_id") between 1 and 128
    and length("brand_owner_transfer"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `brand_owner_transfer_brand_idx` ON `brand_owner_transfer` (`brand_id`,`created_at`,`id`);