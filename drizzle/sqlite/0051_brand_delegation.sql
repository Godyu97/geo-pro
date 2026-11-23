CREATE TABLE `agency_membership` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`active` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agency_membership_state_check" CHECK("agency_membership"."active" in (0, 1)
    and length("agency_membership"."id") = 36
    and length("agency_membership"."organization_id") = 36
    and length("agency_membership"."user_id") between 1 and 128
    and length("agency_membership"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agency_membership_pair_uidx` ON `agency_membership` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `agency_membership_user_idx` ON `agency_membership` (`user_id`,`organization_id`) WHERE "agency_membership"."active" = 1;--> statement-breakpoint
CREATE TABLE `brand_delegation` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`active` integer NOT NULL,
	`expires_at` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL,
	`expired_at` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "brand_delegation_state_check" CHECK("brand_delegation"."active" in (0, 1)
    and length("brand_delegation"."id") = 36
    and length("brand_delegation"."brand_id") = 36
    and length("brand_delegation"."organization_id") = 36
    and length("brand_delegation"."expires_at") between 20 and 40
    and length("brand_delegation"."created_at") between 20 and 40
    and length("brand_delegation"."scope") between 8 and 600
    and "brand_delegation"."scope" = lower("brand_delegation"."scope")
    and "brand_delegation"."scope" not glob '*[^-a-z0-9,]*'
    and "brand_delegation"."scope" not like '%,,%'
    and "brand_delegation"."scope" not like ',%'
    and "brand_delegation"."scope" not like '%,'
    and (("brand_delegation"."active" = 1 and "brand_delegation"."expired_at" is null)
      or ("brand_delegation"."active" = 0 and length("brand_delegation"."expired_at") between 20 and 40)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_delegation_pair_uidx` ON `brand_delegation` (`organization_id`,`brand_id`);--> statement-breakpoint
CREATE INDEX `brand_delegation_org_idx` ON `brand_delegation` (`organization_id`,`brand_id`);--> statement-breakpoint
CREATE TABLE `delegation_action` (
	`id` text PRIMARY KEY NOT NULL,
	`delegation_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`delegation_id`) REFERENCES `brand_delegation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "delegation_action_state_check" CHECK("delegation_action"."status" in ('queued', 'stopped')
    and length("delegation_action"."id") = 36
    and length("delegation_action"."delegation_id") = 36
    and length("delegation_action"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `delegation_action_delegation_idx` ON `delegation_action` (`delegation_id`,`status`);