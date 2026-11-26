ALTER TABLE "brand_group" DROP CONSTRAINT "brand_group_group_id_team_group_id_fk";
--> statement-breakpoint
ALTER TABLE "brand_group" ADD CONSTRAINT "brand_group_group_id_team_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."team_group"("id") ON DELETE cascade ON UPDATE no action;