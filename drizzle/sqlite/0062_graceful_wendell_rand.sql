CREATE TABLE `service_entitlement` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`monitoring_quota` integer NOT NULL,
	`content_quota` integer NOT NULL,
	`labor_quota` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "service_entitlement_state_check" CHECK("service_entitlement"."kind" in ('trial', 'quote')
    and "service_entitlement"."version" between 1 and 1000000
    and "service_entitlement"."monitoring_quota" between 0 and 1000000
    and "service_entitlement"."content_quota" between 0 and 1000000
    and "service_entitlement"."labor_quota" between 0 and 1000000
    and length("service_entitlement"."id") = 36
    and length("service_entitlement"."brand_id") = 36
    and length("service_entitlement"."owner_id") between 1 and 128
    and length("service_entitlement"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_entitlement_brand_kind_version_uidx` ON `service_entitlement` (`brand_id`,`kind`,`version`);--> statement-breakpoint
CREATE INDEX `service_entitlement_owner_idx` ON `service_entitlement` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `entitlement_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`entitlement_id` text NOT NULL,
	`kind` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entitlement_id`) REFERENCES `service_entitlement`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entitlement_usage_state_check" CHECK("entitlement_usage"."kind" in ('monitoring', 'content', 'labor')
    and "entitlement_usage"."quantity" between 1 and 1000000
    and length("entitlement_usage"."id") = 36
    and length("entitlement_usage"."entitlement_id") = 36
    and length("entitlement_usage"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `entitlement_usage_entitlement_idx` ON `entitlement_usage` (`entitlement_id`,`created_at`,`id`);
