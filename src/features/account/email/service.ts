import "server-only";

import { randomBytes } from "node:crypto";
import { createEmailVerificationToken, isAPIError } from "better-auth/api";
import { z } from "zod";
import { getAuth, withAuthTransaction } from "@/lib/auth/server";
import { getConnection } from "@/lib/db/connection";
import type { Locale } from "@/lib/i18n/locale";
import { accountAccessPath, type emailConfirm, type emailRequest, type MailKind } from "./contracts";
import { pruneMailRate } from "./dao";
import { deliverAccountMail, logMailFailure } from "./delivery";

const verifyLifetimeSeconds = 24 * 60 * 60;
const verificationBinding = z.object({ id: z.string(), email: z.email() });

function identifier(kind: MailKind, token: string) {
  return kind === "verify" ? `geo-email-verification:${token}` : `reset-password:${token}`;
}

export async function prepareAccountMail(
  input: z.infer<typeof emailRequest>, locale: Locale, traceId: string,
) {
  try {
    await pruneMailRate(getConnection());
  } catch {
    logMailFailure(input.kind, traceId, "cleanup");
  }
  try {
    const auth = getAuth();
    const context = await auth.$context;
    // Let the shared adapter periodically expire old links outside the transaction
    // used for confirmation. The lookup key cannot identify a user or a token.
    await context.internalAdapter.findVerificationValue("geo-account-mail-cleanup");
    if (input.kind === "reset") {
      const target = new URLSearchParams({ locale, traceId });
      const redirectTo = accountAccessPath("reset", input.returnTo) + "&" + target;
      await auth.api.requestPasswordReset({ body: { email: input.email, redirectTo } });
      return;
    }
    const result = await context.internalAdapter.findUserByEmail(input.email);
    if (!result || result.user.emailVerified) return;

    const token = randomBytes(32).toString("base64url");
    const { id, email } = result.user;
    await context.internalAdapter.createVerificationValue({
      identifier: identifier("verify", token),
      value: JSON.stringify({ id, email }),
      expiresAt: new Date(Date.now() + verifyLifetimeSeconds * 1000),
    });
    await deliverAccountMail("verify", email, token, input.returnTo, locale, traceId);
  } catch {
    logMailFailure(input.kind, traceId, "prepare");
  }
}

class InvalidMailLink extends Error {}

export async function confirmAccountMail(input: z.infer<typeof emailConfirm>, headers: Headers) {
  try {
    await withAuthTransaction(async (auth, lockUser) => {
      const context = await auth.$context;
      const key = identifier(input.action, input.token);
      const record = await context.internalAdapter.findVerificationValue(key);
      if (!record || record.expiresAt.getTime() <= Date.now()) throw new InvalidMailLink();

      const binding = input.action === "verify" ? verificationBinding.parse(JSON.parse(record.value)) : null;
      const userId = binding?.id ?? record.value;
      await lockUser({ id: userId });
      const session = await auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
      if (session && session.user.id !== userId) throw new InvalidMailLink();

      if (input.action === "reset") {
        await auth.api.resetPassword({ body: { token: input.token, newPassword: input.password } });
        return;
      }

      const user = await context.internalAdapter.findUserById(userId);
      if (!user || user.email !== binding?.email) throw new InvalidMailLink();
      if (!await context.internalAdapter.consumeVerificationValue(key)) throw new InvalidMailLink();

      // Only this server-issued assertion reaches Better Auth. The public token
      // is opaque, and its consumption rolls back if the verification write fails.
      const assertion = await createEmailVerificationToken(context.secret, user.email, undefined, 60, { userId });
      await auth.api.verifyEmail({ query: { token: assertion } });
    });
    return input.action === "verify" ? "verified" : "passwordUpdated";
  } catch (error) {
    if (error instanceof InvalidMailLink ||
      (isAPIError(error) && (error.body?.code === "INVALID_TOKEN" || error.body?.code === "USER_NOT_FOUND"))) {
      return "invalidLink";
    }
    throw error;
  }
}
