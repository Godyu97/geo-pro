PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `source_inspection` RENAME TO `__old_source_inspection`;--> statement-breakpoint
CREATE TABLE `source_inspection` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`citation_id` text NOT NULL,
	`state` text NOT NULL,
	`support` text NOT NULL,
	`page_live` integer NOT NULL,
	`readable` integer NOT NULL,
	`author_known` integer NOT NULL,
	`supports_brand` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`citation_id`) REFERENCES `answer_citation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_inspection_check" CHECK("source_inspection"."state" in ('observed', 'resolved', 'limited', 'unknown')
    and "source_inspection"."support" in ('supports', 'does_not_support', 'unknown')
    and "source_inspection"."page_live" in (0, 1)
    and "source_inspection"."readable" in (0, 1)
    and "source_inspection"."author_known" in (0, 1)
    and "source_inspection"."supports_brand" in (0, 1)
    and (
      "source_inspection"."support" = 'unknown'
      or ("source_inspection"."support" = 'supports' and "source_inspection"."page_live" = 1 and "source_inspection"."readable" = 1 and "source_inspection"."author_known" = 1 and "source_inspection"."supports_brand" = 1)
      or ("source_inspection"."support" = 'does_not_support' and "source_inspection"."page_live" = 1 and "source_inspection"."readable" = 1 and "source_inspection"."author_known" = 1 and "source_inspection"."supports_brand" = 0)
    ))
);--> statement-breakpoint
INSERT INTO `source_inspection`("id", "brand_id", "owner_id", "citation_id", "state", "support", "page_live", "readable", "author_known", "supports_brand", "created_at", "updated_at") SELECT "id", "brand_id", "owner_id", "citation_id", "state", "support", "page_live", "readable", "author_known", "supports_brand", "created_at", "updated_at" FROM `__old_source_inspection`;--> statement-breakpoint
DROP TABLE `__old_source_inspection`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `source_inspection_citation_uidx` ON `source_inspection` (`citation_id`);--> statement-breakpoint
CREATE INDEX `source_inspection_brand_idx` ON `source_inspection` (`brand_id`,`citation_id`);