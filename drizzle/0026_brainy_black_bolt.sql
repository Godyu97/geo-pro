ALTER TABLE "report_snapshot" DROP CONSTRAINT "report_snapshot_state_check";--> statement-breakpoint
ALTER TABLE "report_snapshot" ADD COLUMN "html_object_id" text;--> statement-breakpoint
ALTER TABLE "report_snapshot" ADD COLUMN "json_object_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "report_snapshot_html_object_uidx" ON "report_snapshot" USING btree ("html_object_id") WHERE "report_snapshot"."html_object_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_snapshot_json_object_uidx" ON "report_snapshot" USING btree ("json_object_id") WHERE "report_snapshot"."json_object_id" is not null;--> statement-breakpoint
ALTER TABLE "report_snapshot" ADD CONSTRAINT "report_snapshot_state_check" CHECK ("report_snapshot"."status" in ('created', 'superseded')
    and "report_snapshot"."grade" in ('exploratory', 'incomparable')
    and "report_snapshot"."intent" in ('business_loop', 'diagnostic')
    and "report_snapshot"."loop_completed" in (0, 1)
    and "report_snapshot"."source_missing" in (0, 1)
    and "report_snapshot"."entity_version" > 0
    and length("report_snapshot"."json_sha256") = 64
    and length("report_snapshot"."html_sha256") = 64
    and (
      ("report_snapshot"."html_object_id" is null and "report_snapshot"."json_object_id" is null
        and length("report_snapshot"."html_bytes") > 1 and length("report_snapshot"."json_bytes") > 1)
      or ("report_snapshot"."html_object_id" is not null and "report_snapshot"."json_object_id" is not null
        and "report_snapshot"."html_object_id" <> "report_snapshot"."json_object_id"
        and length("report_snapshot"."html_bytes") = 0 and length("report_snapshot"."json_bytes") = 0)
    ));