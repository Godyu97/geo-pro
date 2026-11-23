CREATE TABLE `media_review` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`shown_value` text NOT NULL,
	`approved_value` text NOT NULL,
	`fact_version_id` text NOT NULL,
	`reason` text NOT NULL,
	`deliver` integer NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`,`fact_version_id`) REFERENCES `brand_fact_version`(`brand_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "media_review_state_check" CHECK("media_review"."deliver" in (0, 1)
    and "media_review"."kind" in ('image', 'script')
    and "media_review"."reason" in ('ok', 'fact_mismatch', 'not_proof')
    and (
      ("media_review"."reason" = 'ok' and "media_review"."deliver" = 1 and "media_review"."shown_value" = "media_review"."approved_value")
      or ("media_review"."reason" = 'fact_mismatch' and "media_review"."deliver" = 0 and "media_review"."shown_value" <> "media_review"."approved_value")
      or ("media_review"."reason" = 'not_proof' and "media_review"."deliver" = 0)
    )
    and length("media_review"."id") = 36
    and length("media_review"."brand_id") = 36
    and length("media_review"."owner_id") between 1 and 128
    and length("media_review"."fact_version_id") = 36
    and length("media_review"."shown_value") between 1 and 4000
    and length("media_review"."approved_value") between 1 and 4000
    and length("media_review"."recorded_at") between 20 and 40)
);
--> statement-breakpoint
CREATE INDEX `media_review_owner_idx` ON `media_review` (`owner_id`,`recorded_at`,`id`);--> statement-breakpoint
CREATE INDEX `media_review_owner_brand_idx` ON `media_review` (`owner_id`,`brand_id`,`recorded_at`,`id`);