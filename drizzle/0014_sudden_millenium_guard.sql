CREATE TABLE "answer_analysis_version" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"version" integer NOT NULL,
	"entity_version" integer NOT NULL,
	"rule_version" text NOT NULL,
	"mentioned" text NOT NULL,
	"recommended" text NOT NULL,
	"official_site_cited" text NOT NULL,
	"evidence_span" text,
	"status" text NOT NULL,
	"revised_from" text,
	"reason" text,
	"reviewer_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "answer_analysis_state_check" CHECK ("answer_analysis_version"."version" > 0 and "answer_analysis_version"."entity_version" > 0
    and "answer_analysis_version"."mentioned" in ('true', 'false', 'unknown')
    and "answer_analysis_version"."recommended" in ('true', 'false', 'unknown')
    and "answer_analysis_version"."official_site_cited" in ('true', 'false', 'unknown')
    and "answer_analysis_version"."status" in ('pending', 'classified', 'needs_review', 'revised')
    and ("answer_analysis_version"."revised_from" is null or "answer_analysis_version"."revised_from" <> "answer_analysis_version"."id"))
);
--> statement-breakpoint
CREATE TABLE "answer_citation" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"raw_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"citation_origin" text NOT NULL,
	"position_label" text,
	"ownership" text NOT NULL,
	"page_status" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "answer_citation_state_check" CHECK ("answer_citation"."citation_origin" in ('provider_native', 'consumer_visible', 'search_candidate', 'analyst_found', 'custom_pipeline')
    and "answer_citation"."ownership" in ('owned_domain', 'owned_account', 'competitor', 'third_party', 'unknown')
    and "answer_citation"."page_status" in ('unknown', 'reachable', 'restricted', 'not_applicable'))
);
--> statement-breakpoint
CREATE TABLE "answer_observation" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"slot_id" text,
	"attempt_id" text,
	"source_mode" text NOT NULL,
	"capture_method" text NOT NULL,
	"question_text" text NOT NULL,
	"answer_text" text NOT NULL,
	"fingerprint" text NOT NULL,
	"captured_at" text NOT NULL,
	"region" text NOT NULL,
	"language" text NOT NULL,
	"requested_network_mode" text NOT NULL,
	"entity_version" integer NOT NULL,
	"citation_set_state" text NOT NULL,
	"evidence_state" text NOT NULL,
	"locator_ref" text,
	"collector_id" text,
	"missing_reason" text,
	"created_at" text NOT NULL,
	CONSTRAINT "answer_observation_state_check" CHECK ("answer_observation"."source_mode" in ('model_api', 'consumer_ui')
    and "answer_observation"."capture_method" in ('official_api', 'manual', 'assisted', 'isolated')
    and "answer_observation"."citation_set_state" in ('complete', 'partial', 'unsupported', 'missing')
    and "answer_observation"."evidence_state" in ('draft_evidence', 'complete', 'incomplete', 'contested')
    and "answer_observation"."entity_version" > 0 and length("answer_observation"."fingerprint") = 64
    and length("answer_observation"."region") = 2 and length("answer_observation"."language") between 2 and 40
    and "answer_observation"."requested_network_mode" in ('on', 'off', 'unknown')
    and (
      ("answer_observation"."evidence_state" = 'draft_evidence')
      or ("answer_observation"."evidence_state" in ('complete', 'incomplete', 'contested') and length("answer_observation"."answer_text") > 0)
    )
    and (
      ("answer_observation"."source_mode" = 'consumer_ui' and "answer_observation"."capture_method" in ('manual', 'assisted'))
      or ("answer_observation"."source_mode" = 'model_api' and "answer_observation"."capture_method" in ('official_api', 'isolated', 'assisted'))
    ))
);
--> statement-breakpoint
ALTER TABLE "answer_analysis_version" ADD CONSTRAINT "answer_analysis_observation_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."answer_observation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_citation" ADD CONSTRAINT "answer_citation_observation_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."answer_observation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_observation" ADD CONSTRAINT "answer_observation_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_observation" ADD CONSTRAINT "answer_observation_slot_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."monitoring_slot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_observation" ADD CONSTRAINT "answer_observation_attempt_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."monitoring_attempt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_analysis_version_uidx" ON "answer_analysis_version" USING btree ("observation_id","version");--> statement-breakpoint
CREATE INDEX "answer_analysis_brand_idx" ON "answer_analysis_version" USING btree ("brand_id","observation_id","version");--> statement-breakpoint
CREATE INDEX "answer_citation_observation_idx" ON "answer_citation" USING btree ("observation_id","id");--> statement-breakpoint
CREATE INDEX "answer_citation_brand_idx" ON "answer_citation" USING btree ("brand_id","observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_observation_slot_uidx" ON "answer_observation" USING btree ("slot_id") WHERE "answer_observation"."slot_id" is not null and "answer_observation"."evidence_state" in ('complete', 'incomplete', 'contested');--> statement-breakpoint
CREATE INDEX "answer_observation_brand_idx" ON "answer_observation" USING btree ("brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "answer_observation_owner_idx" ON "answer_observation" USING btree ("owner_id","created_at","id");