CREATE TABLE "industry_pack" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"scope" text NOT NULL,
	"covers_regulated" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "industry_pack_state_check" CHECK ("industry_pack"."covers_regulated" in (0, 1)
    and "industry_pack"."status" in ('draft', 'reviewed', 'available', 'retired')
    and length("industry_pack"."id") = 36
    and length("industry_pack"."brand_id") = 36
    and length("industry_pack"."owner_id") between 1 and 128
    and length("industry_pack"."scope") between 1 and 400
    and length("industry_pack"."created_at") between 20 and 40)
);
--> statement-breakpoint
CREATE TABLE "industry_pack_question" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "industry_pack_question_state_check" CHECK ("industry_pack_question"."status" = 'draft'
    and length("industry_pack_question"."id") = 36
    and length("industry_pack_question"."pack_id") = 36
    and length("industry_pack_question"."body") between 1 and 500
    and length("industry_pack_question"."created_at") between 20 and 40)
);
--> statement-breakpoint
ALTER TABLE "industry_pack" ADD CONSTRAINT "industry_pack_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_pack" ADD CONSTRAINT "industry_pack_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_pack_question" ADD CONSTRAINT "industry_pack_question_pack_id_industry_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."industry_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "industry_pack_owner_idx" ON "industry_pack" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "industry_pack_owner_brand_idx" ON "industry_pack" USING btree ("owner_id","brand_id","created_at","id");--> statement-breakpoint
CREATE INDEX "industry_pack_question_pack_idx" ON "industry_pack_question" USING btree ("pack_id","created_at","id");