CREATE TABLE "entity_correction" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"action" text NOT NULL,
	"effect" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "entity_correction_state_check" CHECK ((("entity_correction"."action" = 'open' and "entity_correction"."effect" in ('open', 'unresolved'))
      or ("entity_correction"."action" = 'actioned' and "entity_correction"."effect" in ('pending_retest', 'unresolved')))
    and length("entity_correction"."owner_id") between 1 and 128
    and length("entity_correction"."observation_id") = 36
    and length("entity_correction"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "entity_disambiguation" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"prior_analysis_id" text NOT NULL,
	"next_analysis_id" text NOT NULL,
	"count_as_target_mention" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "entity_disambiguation_state_check" CHECK ("entity_disambiguation"."count_as_target_mention" = 0
    and "entity_disambiguation"."prior_analysis_id" <> "entity_disambiguation"."next_analysis_id"
    and length("entity_disambiguation"."owner_id") between 1 and 128
    and length("entity_disambiguation"."observation_id") = 36
    and length("entity_disambiguation"."prior_analysis_id") = 36
    and length("entity_disambiguation"."next_analysis_id") = 36
    and length("entity_disambiguation"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "entity_correction" ADD CONSTRAINT "entity_correction_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_correction" ADD CONSTRAINT "entity_correction_observation_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."answer_observation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_disambiguation" ADD CONSTRAINT "entity_disambiguation_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_disambiguation" ADD CONSTRAINT "entity_disambiguation_observation_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."answer_observation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_disambiguation" ADD CONSTRAINT "entity_disambiguation_prior_fk" FOREIGN KEY ("prior_analysis_id") REFERENCES "public"."answer_analysis_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_disambiguation" ADD CONSTRAINT "entity_disambiguation_next_fk" FOREIGN KEY ("next_analysis_id") REFERENCES "public"."answer_analysis_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_correction_event_uidx" ON "entity_correction" USING btree ("observation_id","created_at");--> statement-breakpoint
CREATE INDEX "entity_correction_owner_idx" ON "entity_correction" USING btree ("owner_id","brand_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_disambiguation_prior_uidx" ON "entity_disambiguation" USING btree ("prior_analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_disambiguation_next_uidx" ON "entity_disambiguation" USING btree ("next_analysis_id");--> statement-breakpoint
CREATE INDEX "entity_disambiguation_owner_idx" ON "entity_disambiguation" USING btree ("owner_id","brand_id","created_at","id");