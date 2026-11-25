PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_research_brief` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`question_cluster` text NOT NULL,
	`gap` text NOT NULL,
	`facts_json` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_research_brief`("id", "brand_id", "owner_id", "question_cluster", "gap", "facts_json", "source_ids_json", "status", "created_at", "updated_at") SELECT "id", "brand_id", "owner_id", "question_cluster", "gap", "facts_json", "source_ids_json", "status", "created_at", "updated_at" FROM `research_brief`;--> statement-breakpoint
DROP TABLE `research_brief`;--> statement-breakpoint
CREATE TABLE `research_brief` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`question_cluster` text NOT NULL,
	`gap` text NOT NULL,
	`facts_json` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`content_brief_id` text,
	`optimization_task_id` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_brief_id`) REFERENCES `content_brief`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`optimization_task_id`) REFERENCES `optimization_task`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "research_brief_check" CHECK("research_brief"."status" in ('proposed', 'accepted', 'dismissed')
    and length("research_brief"."question_cluster") between 1 and 200
    and length("research_brief"."gap") between 1 and 2000
    and length("research_brief"."facts_json") between 2 and 8000
    and length("research_brief"."source_ids_json") between 2 and 4000
    and ("research_brief"."content_brief_id" is null or ("research_brief"."status" = 'accepted' and length("research_brief"."content_brief_id") between 1 and 80))
    and ("research_brief"."optimization_task_id" is null or ("research_brief"."status" = 'accepted' and length("research_brief"."optimization_task_id") between 1 and 80)))
);
--> statement-breakpoint
INSERT INTO `research_brief`("id", "brand_id", "owner_id", "question_cluster", "gap", "facts_json", "source_ids_json", "status", "created_at", "updated_at", "content_brief_id", "optimization_task_id") SELECT "id", "brand_id", "owner_id", "question_cluster", "gap", "facts_json", "source_ids_json", "status", "created_at", "updated_at", NULL, NULL FROM `__new_research_brief`;--> statement-breakpoint
DROP TABLE `__new_research_brief`;--> statement-breakpoint
CREATE TABLE `__new_source_inspection` (
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
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_source_inspection`("id", "brand_id", "owner_id", "citation_id", "state", "support", "page_live", "readable", "author_known", "supports_brand", "created_at", "updated_at") SELECT "id", "brand_id", "owner_id", "citation_id", "state", "support", "page_live", "readable", "author_known", "supports_brand", "created_at", "updated_at" FROM `source_inspection`;--> statement-breakpoint
DROP TABLE `source_inspection`;--> statement-breakpoint
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
	`supported_claim` text,
	`fact_version_id` text,
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
    )
    and (
      ("source_inspection"."supported_claim" is null and "source_inspection"."fact_version_id" is null)
      or (
        "source_inspection"."support" = 'supports'
        and "source_inspection"."supported_claim" is not null
        and length("source_inspection"."supported_claim") between 1 and 500
        and ("source_inspection"."fact_version_id" is null or length("source_inspection"."fact_version_id") between 1 and 80)
      )
    ))
);
--> statement-breakpoint
INSERT INTO `source_inspection`("id", "brand_id", "owner_id", "citation_id", "state", "support", "page_live", "readable", "author_known", "supports_brand", "created_at", "updated_at", "supported_claim", "fact_version_id") SELECT "id", "brand_id", "owner_id", "citation_id", "state", "support", "page_live", "readable", "author_known", "supports_brand", "created_at", "updated_at", NULL, NULL FROM `__new_source_inspection`;--> statement-breakpoint
DROP TABLE `__new_source_inspection`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `research_brief_brand_idx` ON `research_brief` (`brand_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `research_brief_owner_idx` ON `research_brief` (`owner_id`,`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_inspection_citation_uidx` ON `source_inspection` (`citation_id`);--> statement-breakpoint
CREATE INDEX `source_inspection_brand_idx` ON `source_inspection` (`brand_id`,`citation_id`);
