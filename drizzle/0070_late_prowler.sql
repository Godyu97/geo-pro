CREATE TABLE "demo_observation" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"question_text" text NOT NULL,
	"answer_text" text NOT NULL,
	"is_demo" integer DEFAULT 1 NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "demo_observation_state_check" CHECK ("demo_observation"."is_demo" = 1
    and length("demo_observation"."id") = 36 and length("demo_observation"."brand_id") = 36
    and length("demo_observation"."owner_id") between 1 and 128
    and length("demo_observation"."question_text") between 1 and 4000
    and length("demo_observation"."answer_text") between 1 and 8000
    and length("demo_observation"."operation_id") = 36
    and length("demo_observation"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "demo_observation" ADD CONSTRAINT "demo_observation_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_observation" ADD CONSTRAINT "demo_observation_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_observation_operation_uidx" ON "demo_observation" USING btree ("brand_id","operation_id");--> statement-breakpoint
CREATE INDEX "demo_observation_owner_idx" ON "demo_observation" USING btree ("owner_id","brand_id","created_at","id");