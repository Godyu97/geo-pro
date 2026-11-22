CREATE TABLE "lead_question_suggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"summary_hash" text NOT NULL,
	"status" text NOT NULL,
	"model_name" text NOT NULL,
	"suggestion_json" text NOT NULL,
	"injection_ignored" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "lead_question_suggestion_state_check" CHECK ("lead_question_suggestion"."status" in ('draft', 'accepted', 'discarded')
    and "lead_question_suggestion"."injection_ignored" in (0, 1)
    and length("lead_question_suggestion"."summary_hash") = 64
    and length("lead_question_suggestion"."model_name") between 1 and 128
    and length("lead_question_suggestion"."suggestion_json") between 20 and 2000
    and length("lead_question_suggestion"."owner_id") between 1 and 128
    and length("lead_question_suggestion"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "lead_question_suggestion" ADD CONSTRAINT "lead_question_suggestion_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_question_suggestion_owner_idx" ON "lead_question_suggestion" USING btree ("owner_id","brand_id","created_at","id");