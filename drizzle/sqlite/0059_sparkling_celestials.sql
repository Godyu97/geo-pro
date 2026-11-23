CREATE TABLE `brand_store` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`service_area` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "brand_store_state_check" CHECK(length("brand_store"."id") = 36
    and length("brand_store"."brand_id") = 36
    and length("brand_store"."owner_id") between 1 and 128
    and length("brand_store"."name") between 1 and 80
    and length("brand_store"."service_area") between 1 and 160
    and length("brand_store"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `brand_store_owner_brand_idx` ON `brand_store` (`owner_id`,`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `store_fact_use` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`service_area` text NOT NULL,
	`used_other_store` integer NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `brand_store`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "store_fact_use_state_check" CHECK("store_fact_use"."used_other_store" = 0
    and length("store_fact_use"."id") = 36
    and length("store_fact_use"."store_id") = 36
    and length("store_fact_use"."owner_id") between 1 and 128
    and length("store_fact_use"."service_area") between 1 and 160
    and length("store_fact_use"."recorded_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `store_fact_use_owner_idx` ON `store_fact_use` (`owner_id`,`recorded_at`,`id`);