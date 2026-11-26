CREATE TABLE "data_connection_sync_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"cursor" text NOT NULL,
	"previous_cursor" text,
	"payload_digest" text NOT NULL,
	"coverage_complete" integer NOT NULL,
	"synced_at" text NOT NULL,
	CONSTRAINT "data_connection_sync_batch_state_check" CHECK (length("data_connection_sync_batch"."id") = 36
    and length("data_connection_sync_batch"."connection_id") = 36
    and length("data_connection_sync_batch"."brand_id") = 36
    and length("data_connection_sync_batch"."owner_id") between 1 and 128
    and "data_connection_sync_batch"."cursor" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
    and ("data_connection_sync_batch"."previous_cursor" is null or ("data_connection_sync_batch"."previous_cursor" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$' and "data_connection_sync_batch"."previous_cursor" <> "data_connection_sync_batch"."cursor"))
    and "data_connection_sync_batch"."payload_digest" ~ '^[a-f0-9]{64}$'
    and "data_connection_sync_batch"."coverage_complete" in (0, 1)
    and length("data_connection_sync_batch"."synced_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "data_connection_sync_batch" ADD CONSTRAINT "data_connection_sync_batch_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connection_sync_batch" ADD CONSTRAINT "data_connection_sync_batch_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connection_sync_batch" ADD CONSTRAINT "data_connection_sync_batch_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."data_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_connection_sync_batch_cursor_uidx" ON "data_connection_sync_batch" USING btree ("connection_id","cursor");--> statement-breakpoint
CREATE INDEX "data_connection_sync_batch_owner_idx" ON "data_connection_sync_batch" USING btree ("owner_id","connection_id","synced_at","id");