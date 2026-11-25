ALTER TABLE "research_brief" DROP CONSTRAINT "research_brief_check";--> statement-breakpoint
ALTER TABLE "source_inspection" DROP CONSTRAINT "source_inspection_check";--> statement-breakpoint
ALTER TABLE "research_brief" ADD COLUMN "content_brief_id" text;--> statement-breakpoint
ALTER TABLE "research_brief" ADD COLUMN "optimization_task_id" text;--> statement-breakpoint
ALTER TABLE "source_inspection" ADD COLUMN "supported_claim" text;--> statement-breakpoint
ALTER TABLE "source_inspection" ADD COLUMN "fact_version_id" text;--> statement-breakpoint
ALTER TABLE "research_brief" ADD CONSTRAINT "research_brief_content_brief_fk" FOREIGN KEY ("content_brief_id") REFERENCES "public"."content_brief"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_brief" ADD CONSTRAINT "research_brief_task_fk" FOREIGN KEY ("optimization_task_id") REFERENCES "public"."optimization_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_brief" ADD CONSTRAINT "research_brief_check" CHECK ("research_brief"."status" in ('proposed', 'accepted', 'dismissed')
    and length("research_brief"."question_cluster") between 1 and 200
    and length("research_brief"."gap") between 1 and 2000
    and length("research_brief"."facts_json") between 2 and 8000
    and length("research_brief"."source_ids_json") between 2 and 4000
    and ("research_brief"."content_brief_id" is null or ("research_brief"."status" = 'accepted' and length("research_brief"."content_brief_id") between 1 and 80))
    and ("research_brief"."optimization_task_id" is null or ("research_brief"."status" = 'accepted' and length("research_brief"."optimization_task_id") between 1 and 80)));--> statement-breakpoint
ALTER TABLE "source_inspection" ADD CONSTRAINT "source_inspection_check" CHECK ("source_inspection"."state" in ('observed', 'resolved', 'limited', 'unknown')
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
    ));