CREATE TABLE "data_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"field_count" integer NOT NULL,
	"pull_attempted_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "data_connection_state_check" CHECK ("data_connection"."status" in ('preview', 'approved')
    and "data_connection"."field_count" between 1 and 40
    and length("data_connection"."display_name") between 1 and 80
    and length("data_connection"."id") = 36
    and length("data_connection"."brand_id") = 36
    and length("data_connection"."owner_id") between 1 and 128
    and length("data_connection"."created_at") between 20 and 40
    and length("data_connection"."updated_at") between 20 and 40
    and (
      ("data_connection"."status" = 'preview' and "data_connection"."pull_attempted_at" is null)
      or (
        "data_connection"."status" = 'approved'
        and ("data_connection"."pull_attempted_at" is null or length("data_connection"."pull_attempted_at") between 20 and 40)
      )
    ))
);
--> statement-breakpoint
CREATE TABLE "data_connection_field" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"position" integer NOT NULL,
	"field_name" text NOT NULL,
	CONSTRAINT "data_connection_field_state_check" CHECK ("data_connection_field"."position" between 0 and 39
    and "data_connection_field"."field_name" ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
    and length("data_connection_field"."id") = 36
    and length("data_connection_field"."connection_id") = 36
    and length("data_connection_field"."brand_id") = 36
    and length("data_connection_field"."owner_id") between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "data_connection" ADD CONSTRAINT "data_connection_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connection" ADD CONSTRAINT "data_connection_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connection_field" ADD CONSTRAINT "data_connection_field_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connection_field" ADD CONSTRAINT "data_connection_field_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connection_field" ADD CONSTRAINT "data_connection_field_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."data_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_connection_owner_idx" ON "data_connection" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_connection_field_connection_idx" ON "data_connection_field" USING btree ("connection_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "data_connection_field_name_uidx" ON "data_connection_field" USING btree ("connection_id","field_name");--> statement-breakpoint
CREATE INDEX "data_connection_field_owner_idx" ON "data_connection_field" USING btree ("owner_id","connection_id","position");