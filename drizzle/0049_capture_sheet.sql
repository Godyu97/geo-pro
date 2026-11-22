CREATE TABLE "capture_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"sheet_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"blocked_by" text,
	"citation_count" integer NOT NULL,
	"status" text NOT NULL,
	"confirmed" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "capture_attempt_state_check" CHECK ("capture_attempt"."status" in ('handoff', 'partial', 'preview')
    and "capture_attempt"."confirmed" in (0, 1)
    and "capture_attempt"."citation_count" between 0 and 1000
    and (
      ("capture_attempt"."blocked_by" in ('captcha', 'login') and "capture_attempt"."status" = 'handoff' and "capture_attempt"."confirmed" = 0)
      or ("capture_attempt"."blocked_by" is null and "capture_attempt"."citation_count" = 0 and "capture_attempt"."status" = 'partial')
      or ("capture_attempt"."blocked_by" is null and "capture_attempt"."citation_count" between 1 and 1000 and "capture_attempt"."status" = 'preview')
    )
    and length("capture_attempt"."id") = 36
    and length("capture_attempt"."sheet_id") = 36
    and length("capture_attempt"."brand_id") = 36
    and length("capture_attempt"."owner_id") between 1 and 128
    and ("capture_attempt"."blocked_by" is null or length("capture_attempt"."blocked_by") between 5 and 7)
    and length("capture_attempt"."created_at") between 20 and 40
    and length("capture_attempt"."updated_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "capture_sheet" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"prompt_ids_json" text NOT NULL,
	"mode" text NOT NULL,
	"assisted_minutes" integer,
	"manual_minutes" integer,
	"citations_complete" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "capture_sheet_state_check" CHECK ("capture_sheet"."mode" in ('assisted', 'manual')
    and "capture_sheet"."citations_complete" in (0, 1)
    and ("capture_sheet"."assisted_minutes" is null or "capture_sheet"."assisted_minutes" between 0 and 100000)
    and ("capture_sheet"."manual_minutes" is null or "capture_sheet"."manual_minutes" between 0 and 100000)
    and length("capture_sheet"."prompt_ids_json") between 40 and 8000
    and length("capture_sheet"."id") = 36
    and length("capture_sheet"."brand_id") = 36
    and length("capture_sheet"."owner_id") between 1 and 128
    and length("capture_sheet"."created_at") between 20 and 40
    and length("capture_sheet"."updated_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD CONSTRAINT "capture_attempt_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_attempt" ADD CONSTRAINT "capture_attempt_sheet_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."capture_sheet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_sheet" ADD CONSTRAINT "capture_sheet_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capture_attempt_sheet_idx" ON "capture_attempt" USING btree ("owner_id","sheet_id","created_at","id");--> statement-breakpoint
CREATE INDEX "capture_sheet_owner_idx" ON "capture_sheet" USING btree ("owner_id","brand_id","created_at","id");