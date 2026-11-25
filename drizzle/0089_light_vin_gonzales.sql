ALTER TABLE "data_connection_field" DROP CONSTRAINT "data_connection_field_connection_fk";--> statement-breakpoint
CREATE TABLE "data_connection_next" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"field_count" integer NOT NULL,
	"pull_attempted_at" text,
	"sync_cursor" text,
	"coverage_complete" integer,
	"sync_stopped" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);--> statement-breakpoint
INSERT INTO "data_connection_next" (
	"id", "brand_id", "owner_id", "display_name", "status", "field_count", "pull_attempted_at",
	"sync_cursor", "coverage_complete", "sync_stopped", "created_at", "updated_at"
) SELECT
	"id", "brand_id", "owner_id", "display_name", "status", "field_count", "pull_attempted_at",
	NULL, NULL, 0, "created_at", "updated_at"
FROM "data_connection";--> statement-breakpoint
DROP TABLE "data_connection";--> statement-breakpoint
ALTER TABLE "data_connection_next" RENAME TO "data_connection";--> statement-breakpoint
ALTER TABLE "data_connection" RENAME CONSTRAINT "data_connection_next_pkey" TO "data_connection_pkey";--> statement-breakpoint
ALTER TABLE "data_connection" RENAME CONSTRAINT "data_connection_next_id_not_null" TO "data_connection_id_not_null";--> statement-breakpoint
ALTER TABLE "data_connection" RENAME CONSTRAINT "data_connection_next_brand_id_not_null" TO "data_connection_brand_id_not_null";--> statement-breakpoint
ALTER TABLE "data_connection" RENAME CONSTRAINT "data_connection_next_owner_id_not_null" TO "data_connection_owner_id_not_null";--> statement-breakpoint
ALTER TABLE "data_connection" RENAME CONSTRAINT "data_connection_next_display_name_not_null" TO "data_connection_display_name_not_null";--> statement-breakpoint
ALTER TABLE "data_connection" RENAME CONSTRAINT "data_connection_next_status_not_null" TO "data_connection_status_not_null";--> statement-breakpoint
ALTER TABLE "data_connection" RENAME CONSTRAINT "data_connection_next_field_count_not_null" TO "data_connection_field_count_not_null";--> statement-breakpoint
ALTER TABLE "data_connection" RENAME CONSTRAINT "data_connection_next_sync_stopped_not_null" TO "data_connection_sync_stopped_not_null";--> statement-breakpoint
ALTER TABLE "data_connection" RENAME CONSTRAINT "data_connection_next_created_at_not_null" TO "data_connection_created_at_not_null";--> statement-breakpoint
ALTER TABLE "data_connection" RENAME CONSTRAINT "data_connection_next_updated_at_not_null" TO "data_connection_updated_at_not_null";--> statement-breakpoint
ALTER TABLE "data_connection" ADD CONSTRAINT "data_connection_state_check" CHECK ("data_connection"."status" in ('preview', 'approved')
    and "data_connection"."field_count" between 1 and 40
    and length("data_connection"."display_name") between 1 and 80
    and length("data_connection"."id") = 36
    and length("data_connection"."brand_id") = 36
    and length("data_connection"."owner_id") between 1 and 128
    and length("data_connection"."created_at") between 20 and 40
    and length("data_connection"."updated_at") between 20 and 40
    and "data_connection"."sync_stopped" in (0, 1)
    and (
      ("data_connection"."sync_cursor" is null and "data_connection"."coverage_complete" is null)
      or (
        "data_connection"."sync_cursor" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
        and "data_connection"."coverage_complete" in (0, 1)
      )
    )
    and (
      ("data_connection"."status" = 'preview' and "data_connection"."pull_attempted_at" is null and "data_connection"."sync_cursor" is null and "data_connection"."sync_stopped" = 0)
      or (
        "data_connection"."status" = 'approved'
        and ("data_connection"."pull_attempted_at" is null or length("data_connection"."pull_attempted_at") between 20 and 40)
      )
    ));--> statement-breakpoint
ALTER TABLE "data_connection" ADD CONSTRAINT "data_connection_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connection" ADD CONSTRAINT "data_connection_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_connection_owner_idx" ON "data_connection" USING btree ("owner_id","created_at","id");--> statement-breakpoint
ALTER TABLE "data_connection_field" ADD CONSTRAINT "data_connection_field_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."data_connection"("id") ON DELETE cascade ON UPDATE no action;
