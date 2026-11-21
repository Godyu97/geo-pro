ALTER TABLE "user_data_export" DROP CONSTRAINT "user_data_export_fingerprint_check";--> statement-breakpoint
ALTER TABLE "user_data_export" ADD COLUMN "object_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "user_data_export_object_uidx" ON "user_data_export" USING btree ("object_id") WHERE "user_data_export"."object_id" is not null;--> statement-breakpoint
ALTER TABLE "user_data_export" ADD CONSTRAINT "user_data_export_fingerprint_check" CHECK ((
      "user_data_export"."included" = 0 and "user_data_export"."fingerprint" is null and "user_data_export"."object_id" is null
    ) or (
      "user_data_export"."included" <> 0 and "user_data_export"."fingerprint" is not null and length("user_data_export"."fingerprint") = 64
      and ("user_data_export"."object_id" is null or length("user_data_export"."object_id") = 36)
    ));