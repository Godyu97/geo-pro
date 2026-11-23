CREATE TABLE "run_protocol_pin" (
	"run_id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"protocol_id" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "run_protocol_pin_state_check" CHECK ("run_protocol_pin"."version" > 0
    and length("run_protocol_pin"."run_id") = 36 and length("run_protocol_pin"."brand_id") = 36
    and length("run_protocol_pin"."owner_id") between 1 and 128 and length("run_protocol_pin"."protocol_id") = 36
    and length("run_protocol_pin"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "sampling_protocol" (
	"id" text PRIMARY KEY NOT NULL,
	"protocol_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"version" integer NOT NULL,
	"new_session_required" integer NOT NULL,
	"search_required" integer NOT NULL,
	"target_region" text NOT NULL,
	"timezone" text NOT NULL,
	"status" text NOT NULL,
	"fingerprint" text NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "sampling_protocol_version_key" UNIQUE("protocol_id","version"),
	CONSTRAINT "sampling_protocol_state_check" CHECK ("sampling_protocol"."version" > 0
    and "sampling_protocol"."new_session_required" in (0, 1) and "sampling_protocol"."search_required" in (0, 1)
    and "sampling_protocol"."status" in ('draft', 'frozen')
    and length("sampling_protocol"."id") = 36 and length("sampling_protocol"."protocol_id") = 36
    and length("sampling_protocol"."brand_id") = 36 and length("sampling_protocol"."owner_id") between 1 and 128
    and length("sampling_protocol"."target_region") = 2 and length("sampling_protocol"."timezone") between 1 and 64
    and length("sampling_protocol"."fingerprint") = 64 and length("sampling_protocol"."operation_id") = 36
    and length("sampling_protocol"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "run_protocol_pin" ADD CONSTRAINT "run_protocol_pin_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_protocol_pin" ADD CONSTRAINT "run_protocol_pin_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_protocol_pin" ADD CONSTRAINT "run_protocol_pin_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monitoring_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_protocol_pin" ADD CONSTRAINT "run_protocol_pin_protocol_fk" FOREIGN KEY ("protocol_id","version") REFERENCES "public"."sampling_protocol"("protocol_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_protocol" ADD CONSTRAINT "sampling_protocol_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_protocol" ADD CONSTRAINT "sampling_protocol_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_protocol_pin_protocol_idx" ON "run_protocol_pin" USING btree ("protocol_id","version");--> statement-breakpoint
CREATE INDEX "run_protocol_pin_owner_idx" ON "run_protocol_pin" USING btree ("owner_id","created_at","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sampling_protocol_fingerprint_uidx" ON "sampling_protocol" USING btree ("protocol_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "sampling_protocol_operation_uidx" ON "sampling_protocol" USING btree ("brand_id","operation_id");--> statement-breakpoint
CREATE INDEX "sampling_protocol_owner_idx" ON "sampling_protocol" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "sampling_protocol_family_idx" ON "sampling_protocol" USING btree ("owner_id","protocol_id","version");