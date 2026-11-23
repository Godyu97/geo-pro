CREATE TABLE "brand_storage_limit" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"byte_limit" integer NOT NULL,
	CONSTRAINT "brand_storage_limit_bytes_check" CHECK ("brand_storage_limit"."byte_limit" between 1 and 2147483647)
);
--> statement-breakpoint
ALTER TABLE "source_original" DROP CONSTRAINT "source_original_state_check";--> statement-breakpoint
ALTER TABLE "brand_storage_limit" ADD CONSTRAINT "brand_storage_limit_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_object_brand_live_idx" ON "stored_object" USING btree ("brand_id") WHERE "stored_object"."status" in ('pending', 'ready') and "stored_object"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "source_original" ADD CONSTRAINT "source_original_state_check" CHECK ("source_original"."status" in ('ready', 'partial', 'failed')
    and "source_original"."rights_status" in ('active', 'revoked', 'expired')
    and ("source_original"."reason" is null or "source_original"."reason" in ('encrypted', 'oversized', 'unrecognized', 'batch_limit', 'unavailable', 'capacity'))
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
    ));