CREATE TABLE "prompt_ai_suggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"prompt_set_id" text,
	"status" text NOT NULL,
	"model_name" text NOT NULL,
	"candidate" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "prompt_ai_suggestion_state_check" CHECK ("prompt_ai_suggestion"."status" in ('draft', 'accepted', 'dismissed')
    and length("prompt_ai_suggestion"."model_name") between 1 and 128
    and length("prompt_ai_suggestion"."owner_id") between 1 and 128
    and length("prompt_ai_suggestion"."candidate") between 2 and 8000
    and length("prompt_ai_suggestion"."created_at") between 20 and 40
    and ("prompt_ai_suggestion"."prompt_set_id" is null or length("prompt_ai_suggestion"."prompt_set_id") = 36))
);
--> statement-breakpoint
ALTER TABLE "prompt_ai_suggestion" ADD CONSTRAINT "prompt_ai_suggestion_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompt_ai_suggestion_owner_idx" ON "prompt_ai_suggestion" USING btree ("brand_id","owner_id","created_at");