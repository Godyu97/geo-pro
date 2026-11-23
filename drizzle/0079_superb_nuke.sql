CREATE TABLE "strategy_template" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"industry" text NOT NULL,
	"sampling_condition" text NOT NULL,
	"evidence_strength" text NOT NULL,
	"failure_case" text NOT NULL,
	"explanation" text NOT NULL,
	"strategy_label" text NOT NULL,
	"guaranteed" integer NOT NULL,
	"successes" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "strategy_template_state_check" CHECK ("strategy_template"."strategy_label" = 'observation'
    and "strategy_template"."guaranteed" = 0
    and "strategy_template"."successes" between 0 and 1000000
    and "strategy_template"."evidence_strength" in ('single_observation', 'repeated_observation', 'insufficient')
    and (
      ("strategy_template"."successes" >= 2 and "strategy_template"."evidence_strength" in ('single_observation', 'repeated_observation'))
      or ("strategy_template"."successes" = 1 and "strategy_template"."evidence_strength" = 'single_observation')
      or ("strategy_template"."successes" = 0 and "strategy_template"."evidence_strength" = 'insufficient')
    )
    and length("strategy_template"."id") = 36
    and length("strategy_template"."brand_id") = 36
    and length("strategy_template"."owner_id") between 1 and 128
    and length("strategy_template"."industry") between 1 and 120
    and length("strategy_template"."sampling_condition") between 1 and 500
    and length("strategy_template"."failure_case") between 1 and 2000
    and length("strategy_template"."explanation") between 1 and 4000
    and length("strategy_template"."created_at") between 20 and 40
    and length("strategy_template"."updated_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "strategy_template" ADD CONSTRAINT "strategy_template_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_template" ADD CONSTRAINT "strategy_template_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategy_template_owner_idx" ON "strategy_template" USING btree ("owner_id","brand_id","created_at","id");