CREATE TABLE `team_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`invitee_user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`replaced_by` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitee_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "team_invitation_state_check" CHECK("team_invitation"."role" = 'member'
    and "team_invitation"."status" in ('open', 'accepted', 'expired', 'revoked')
    and "team_invitation"."invitee_user_id" <> "team_invitation"."created_by"
    and length("team_invitation"."invitee_user_id") between 1 and 128
    and length("team_invitation"."created_by") between 1 and 128
    and length("team_invitation"."token_hash") = 64
    and "team_invitation"."token_hash" = lower("team_invitation"."token_hash")
    and length("team_invitation"."expires_at") between 20 and 40
    and length("team_invitation"."created_at") between 20 and 40
    and (("team_invitation"."status" in ('open', 'accepted', 'revoked') and "team_invitation"."replaced_by" is null)
      or ("team_invitation"."status" = 'expired' and ("team_invitation"."replaced_by" is null or length("team_invitation"."replaced_by") between 1 and 128))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invitation_token_uidx` ON `team_invitation` (`token_hash`);--> statement-breakpoint
CREATE INDEX `team_invitation_invitee_idx` ON `team_invitation` (`invitee_user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `team_invitation_brand_idx` ON `team_invitation` (`brand_id`,`created_at`,`id`);