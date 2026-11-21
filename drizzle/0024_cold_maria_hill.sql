CREATE TABLE "stored_object" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"brand_id" text,
	"class" text NOT NULL,
	"visibility" text NOT NULL,
	"status" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"file_name" text,
	"immutable" integer NOT NULL,
	"created_at" text NOT NULL,
	"ready_at" text,
	"deleted_at" text,
	CONSTRAINT "stored_object_check" CHECK ("stored_object"."class" in ('internal-material', 'authorized-media', 'delivery-package', 'report-snapshot', 'owned-export', 'publication-evidence', 'source-original')
    and "stored_object"."visibility" in ('internal', 'public')
    and ("stored_object"."visibility" = 'internal' or "stored_object"."class" = 'authorized-media')
    and "stored_object"."status" in ('pending', 'ready', 'failed', 'tombstoned')
    and "stored_object"."immutable" in (0, 1)
    and (
      ("stored_object"."class" in ('delivery-package', 'report-snapshot', 'owned-export', 'publication-evidence') and "stored_object"."immutable" = 1)
      or ("stored_object"."class" in ('internal-material', 'authorized-media', 'source-original') and "stored_object"."immutable" = 0)
    )
    and (
      ("stored_object"."class" = 'owned-export' and "stored_object"."brand_id" is null and "stored_object"."byte_size" between 1 and 8388608)
      or ("stored_object"."class" <> 'owned-export' and "stored_object"."brand_id" is not null and "stored_object"."byte_size" between 1 and 10485760)
    )
    and length("stored_object"."sha256") = 64
    and "stored_object"."sha256" = lower("stored_object"."sha256")
    and length("stored_object"."bucket") between 3 and 63
    and length("stored_object"."content_type") between 3 and 255
    and length("stored_object"."created_at") between 20 and 40
    and (
      ("stored_object"."class" = 'authorized-media' and "stored_object"."content_type" in ('image/jpeg', 'image/png', 'image/webp'))
      or ("stored_object"."class" = 'publication-evidence' and "stored_object"."content_type" in ('image/jpeg', 'image/png', 'image/webp'))
      or ("stored_object"."class" = 'internal-material' and "stored_object"."content_type" in ('image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/markdown', 'application/pdf', 'application/json'))
      or ("stored_object"."class" = 'delivery-package' and "stored_object"."content_type" in ('text/markdown', 'text/html', 'application/json'))
      or ("stored_object"."class" = 'report-snapshot' and "stored_object"."content_type" in ('text/html', 'application/json'))
      or ("stored_object"."class" = 'owned-export' and "stored_object"."content_type" = 'application/json')
      or ("stored_object"."class" = 'source-original' and "stored_object"."content_type" in ('text/plain', 'text/markdown', 'application/pdf', 'application/json'))
    )
    and (
      ("stored_object"."status" = 'tombstoned' and "stored_object"."deleted_at" is not null and "stored_object"."file_name" is null and "stored_object"."object_key" is null)
      or ("stored_object"."status" in ('pending', 'failed') and "stored_object"."deleted_at" is null and "stored_object"."ready_at" is null and "stored_object"."file_name" is not null and "stored_object"."object_key" is not null)
      or ("stored_object"."status" = 'ready' and "stored_object"."deleted_at" is null and "stored_object"."ready_at" is not null and "stored_object"."file_name" is not null and "stored_object"."object_key" is not null)
    )
    and (
      "stored_object"."object_key" is null
      or (
        length("stored_object"."object_key") between 8 and 1024
        and "stored_object"."object_key" like 'v1/%'
        and "stored_object"."object_key" not like '%..%'
        and "stored_object"."file_name" is not null
        and length("stored_object"."file_name") between 1 and 120
        and "stored_object"."file_name" not like '%/%'
        and "stored_object"."file_name" not like '%..%'
      )
    )
    and ("stored_object"."ready_at" is null or length("stored_object"."ready_at") between 20 and 40)
    and ("stored_object"."deleted_at" is null or length("stored_object"."deleted_at") between 20 and 40))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stored_object_key_uidx" ON "stored_object" USING btree ("object_key") WHERE "stored_object"."object_key" is not null;--> statement-breakpoint
CREATE INDEX "stored_object_owner_idx" ON "stored_object" USING btree ("owner_id","brand_id","class","created_at","id");--> statement-breakpoint
CREATE INDEX "stored_object_brand_idx" ON "stored_object" USING btree ("brand_id","created_at","id");