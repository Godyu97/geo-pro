CREATE TABLE `auth_mail_rate` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_mail_rate_expiry_idx` ON `auth_mail_rate` (`expires_at`);