CREATE TABLE "source_original" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"file_name" text NOT NULL,
	"byte_size" integer NOT NULL,
	"stored_object_id" text,
	"status" text NOT NULL,
	"reason" text,
	"rights_status" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "source_original_state_check" CHECK ("source_original"."status" in ('ready', 'partial', 'failed')
    and "source_original"."rights_status" in ('active', 'revoked', 'expired')
    and ("source_original"."reason" is null or "source_original"."reason" in ('encrypted', 'oversized', 'unrecognized', 'batch_limit', 'unavailable'))
    and length("source_original"."file_name") between 1 and 120
    and "source_original"."file_name" not like '%/%'
    and "source_original"."file_name" not like '%..%'
    and length("source_original"."batch_id") between 1 and 64
    and length("source_original"."created_at") between 20 and 40
    and (
      ("source_original"."status" in ('ready', 'partial')
        and "source_original"."stored_object_id" is not null
        and "source_original"."reason" is null
        and "source_original"."byte_size" between 1 and 10485760)
      or ("source_original"."status" = 'failed'
        and "source_original"."stored_object_id" is null
        and "source_original"."reason" is not null
        and "source_original"."rights_status" = 'active'
        and "source_original"."byte_size" between 0 and 2147483647)
    ))
);
--> statement-breakpoint
ALTER TABLE "source_original" ADD CONSTRAINT "source_original_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_original_object_uidx" ON "source_original" USING btree ("stored_object_id") WHERE "source_original"."stored_object_id" is not null;--> statement-breakpoint
CREATE INDEX "source_original_owner_idx" ON "source_original" USING btree ("owner_id","brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "source_original_brand_idx" ON "source_original" USING btree ("brand_id","created_at","id");