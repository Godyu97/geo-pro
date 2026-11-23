CREATE TABLE `industry_pack` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`scope` text NOT NULL,
	`covers_regulated` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "industry_pack_state_check" CHECK("industry_pack"."covers_regulated" in (0, 1)
    and "industry_pack"."status" in ('draft', 'reviewed', 'available', 'retired')
    and length("industry_pack"."id") = 36
    and length("industry_pack"."brand_id") = 36
    and length("industry_pack"."owner_id") between 1 and 128
    and length("industry_pack"."scope") between 1 and 400
    and length("industry_pack"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `industry_pack_owner_idx` ON `industry_pack` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `industry_pack_owner_brand_idx` ON `industry_pack` (`owner_id`,`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `industry_pack_question` (
	`id` text PRIMARY KEY NOT NULL,
	`pack_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pack_id`) REFERENCES `industry_pack`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "industry_pack_question_state_check" CHECK("industry_pack_question"."status" = 'draft'
    and length("industry_pack_question"."id") = 36
    and length("industry_pack_question"."pack_id") = 36
    and length("industry_pack_question"."body") between 1 and 500
    and length("industry_pack_question"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `industry_pack_question_pack_idx` ON `industry_pack_question` (`pack_id`,`created_at`,`id`);