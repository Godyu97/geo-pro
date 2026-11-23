CREATE TABLE "sync_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"authorization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"result" text NOT NULL,
	"attempted_at" text NOT NULL,
	CONSTRAINT "sync_attempt_state_check" CHECK ("sync_attempt"."result" in ('allowed', 'stopped')
    and length("sync_attempt"."id") = 36
    and length("sync_attempt"."authorization_id") = 36
    and length("sync_attempt"."brand_id") = 36
    and length("sync_attempt"."owner_id") between 1 and 128
    and length("sync_attempt"."attempted_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "sync_authorization" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"source_name" text NOT NULL,
	"revoked" integer NOT NULL,
	"retained_rows" integer NOT NULL,
	"history_deleted" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "sync_authorization_state_check" CHECK ("sync_authorization"."revoked" in (0, 1)
    and "sync_authorization"."history_deleted" = 0
    and "sync_authorization"."retained_rows" between 0 and 1000000000
    and length("sync_authorization"."source_name") between 1 and 80
    and length("sync_authorization"."id") = 36
    and length("sync_authorization"."brand_id") = 36
    and length("sync_authorization"."owner_id") between 1 and 128
    and length("sync_authorization"."created_at") between 20 and 40
    and length("sync_authorization"."updated_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "sync_attempt" ADD CONSTRAINT "sync_attempt_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_attempt" ADD CONSTRAINT "sync_attempt_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_attempt" ADD CONSTRAINT "sync_attempt_authorization_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."sync_authorization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_authorization" ADD CONSTRAINT "sync_authorization_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_authorization" ADD CONSTRAINT "sync_authorization_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_attempt_owner_idx" ON "sync_attempt" USING btree ("owner_id","authorization_id","attempted_at","id");--> statement-breakpoint
CREATE INDEX "sync_authorization_owner_idx" ON "sync_authorization" USING btree ("owner_id","created_at","id");