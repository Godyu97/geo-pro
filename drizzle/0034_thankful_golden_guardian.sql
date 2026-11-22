CREATE TABLE "quality_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"window_id" text NOT NULL,
	"status" text NOT NULL,
	"claim_brand_decline" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "quality_alert_state_check" CHECK ("quality_alert"."kind" in ('data_quality', 'trend')
    and "quality_alert"."status" in ('open', 'acknowledged', 'snoozed', 'resolved')
    and "quality_alert"."claim_brand_decline" in (0, 1)
    and (
      ("quality_alert"."kind" = 'data_quality' and "quality_alert"."claim_brand_decline" = 0
        and "quality_alert"."reason" in ('coverage_insufficient', 'citation_field_changed', 'mode_changed'))
      or ("quality_alert"."kind" = 'trend' and "quality_alert"."claim_brand_decline" = 1 and "quality_alert"."reason" = 'recommendation_drop')
    )
    and length("quality_alert"."window_id") between 1 and 64
    and length("quality_alert"."owner_id") between 1 and 128
    and length("quality_alert"."created_at") between 20 and 40
    and length("quality_alert"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "quality_alert_event" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"occurred_at" text NOT NULL,
	CONSTRAINT "quality_alert_event_state_check" CHECK (length("quality_alert_event"."owner_id") between 1 and 128
    and length("quality_alert_event"."occurred_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "quality_alert" ADD CONSTRAINT "quality_alert_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_alert_event" ADD CONSTRAINT "quality_alert_event_alert_id_quality_alert_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."quality_alert"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_alert_event" ADD CONSTRAINT "quality_alert_event_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quality_alert_open_window_uidx" ON "quality_alert" USING btree ("brand_id","kind","window_id") WHERE "quality_alert"."status" <> 'resolved';--> statement-breakpoint
CREATE INDEX "quality_alert_owner_idx" ON "quality_alert" USING btree ("owner_id","brand_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "quality_alert_event_alert_idx" ON "quality_alert_event" USING btree ("owner_id","alert_id","occurred_at","id");