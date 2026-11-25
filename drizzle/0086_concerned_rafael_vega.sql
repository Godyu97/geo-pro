ALTER TABLE "brand_member_grant" DROP CONSTRAINT "brand_member_grant_state_check";--> statement-breakpoint
ALTER TABLE "brand_member_grant" ADD CONSTRAINT "brand_member_grant_state_check" CHECK ("brand_member_grant"."role" in ('owner', 'member', 'read_only')
    and "brand_member_grant"."active" in (0, 1)
    and length("brand_member_grant"."user_id") between 1 and 128
    and length("brand_member_grant"."created_at") between 20 and 40
    and ("brand_member_grant"."expires_at" is null or length("brand_member_grant"."expires_at") between 20 and 40)
    and (("brand_member_grant"."active" = 1 and "brand_member_grant"."revoked_at" is null)
      or ("brand_member_grant"."active" = 0 and length("brand_member_grant"."revoked_at") between 20 and 40)));