CREATE TABLE `service_order` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`quoted` integer NOT NULL,
	`status` text NOT NULL,
	`paid` integer NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "service_order_state_check" CHECK("service_order"."paid" = 0
    and "service_order"."quoted" in (0, 1)
    and "service_order"."status" in ('draft', 'awaiting_payment')
    and (("service_order"."quoted" = 1 and "service_order"."status" = 'awaiting_payment')
      or ("service_order"."quoted" = 0 and "service_order"."status" = 'draft'))
    and "service_order"."amount" between 0 and 2000000000
    and length("service_order"."currency") = 3
    and "service_order"."currency" = upper("service_order"."currency")
    and "service_order"."currency" not glob '*[^A-Z]*'
    and length("service_order"."id") = 36
    and length("service_order"."brand_id") = 36
    and length("service_order"."owner_id") between 1 and 128
    and length("service_order"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `service_order_owner_idx` ON `service_order` (`owner_id`,`created_at`,`id`);