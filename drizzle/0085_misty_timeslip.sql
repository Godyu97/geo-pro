ALTER TABLE "source_inspection" DROP CONSTRAINT "source_inspection_check";--> statement-breakpoint
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
    ));