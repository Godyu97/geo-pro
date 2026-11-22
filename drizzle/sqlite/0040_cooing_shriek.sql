CREATE TABLE `business_lead` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`event_id` text NOT NULL,
	`primary_class` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "business_lead_state_check" CHECK("business_lead"."primary_class" in ('referral', 'self_report', 'landing_page', 'unknown')
    and length("business_lead"."event_id") between 1 and 64
    and length("business_lead"."owner_id") between 1 and 128
    and length("business_lead"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_lead_brand_event_uidx` ON `business_lead` (`brand_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `business_lead_owner_idx` ON `business_lead` (`owner_id`,`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `business_lead_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`category` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `business_lead`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "business_lead_evidence_state_check" CHECK("business_lead_evidence"."category" in ('referral', 'self_report', 'landing_page', 'unknown')
    and "business_lead_evidence"."position" between 1 and 4
    and length("business_lead_evidence"."owner_id") between 1 and 128
    and length("business_lead_evidence"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_lead_evidence_lead_idx` ON `business_lead_evidence` (`lead_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `business_lead_evidence_category_uidx` ON `business_lead_evidence` (`lead_id`,`category`);