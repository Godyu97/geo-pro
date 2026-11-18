import { z } from "zod";
import { safeReturnTo } from "@/lib/auth/return-to";
import { emailSchema, passwordSchema } from "@/lib/auth/validation";
import { locales } from "@/lib/i18n/locale";

export const mailKind = z.enum(["verify", "reset"]);
export type MailKind = z.infer<typeof mailKind>;

export const emailPageMode = z.enum(["verify", "forgot", "confirm", "reset"]);
export type EmailPageMode = z.infer<typeof emailPageMode>;

const returnToSchema = z.string().max(2048).optional();
export const emailRequest = z.strictObject({
  action: z.literal("request"),
  kind: mailKind,
  email: emailSchema.transform((email) => email.toLowerCase()),
  returnTo: returnToSchema,
});

export const emailConfirm = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("verify"), token: z.string().regex(/^[\w-]{43}$/) }),
  z.strictObject({
    action: z.literal("reset"),
    token: z.string().regex(/^[\w-]{24}$/),
    password: passwordSchema,
  }),
]);

export const mailLocale = z.enum(locales);

export function accountAccessPath(mode: EmailPageMode, returnTo: unknown) {
  return "/account-access?" + new URLSearchParams({ mode, returnTo: safeReturnTo(returnTo) });
}

export const emailOutcomes = [
  "accepted", "verified", "passwordUpdated", "invalidInput", "invalidLink", "rateLimited", "unavailable",
] as const;
export type EmailOutcome = (typeof emailOutcomes)[number];
