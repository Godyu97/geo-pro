import "server-only";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { getAuthEnvironment, isAuthConfigured } from "@/lib/auth/env";
import { isTrustedAppOrigin } from "@/lib/auth/origin";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getWebCorsConfig } from "@/lib/http/web-cors";
import { getLocale } from "@/lib/i18n/server";
import { emailConfirm, emailRequest, type EmailOutcome } from "./contracts";
import { reserveMailRequest } from "./dao";
import { getMailConfiguration, isMailMockEnabled, sourceIP } from "./delivery";
import { confirmAccountMail, prepareAccountMail } from "./service";

function respond(outcome: EmailOutcome, status: number, traceId?: string, retryAfter?: number) {
  const headers = new Headers({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
  if (retryAfter) headers.set("Retry-After", String(retryAfter));
  return Response.json({ outcome, traceId }, { status, headers });
}

export async function accountEmailResponse(request: Request) {
  if (!isAuthConfigured()) return respond("unavailable", 503);
  const auth = getAuthEnvironment();
  const origin = new URL(auth.BETTER_AUTH_URL).origin;
  if (!isTrustedAppOrigin(auth.BETTER_AUTH_URL, request, getWebCorsConfig().origins)) return respond("invalidInput", 403);

  const body = await readBoundedJson(request, 12 * 1024);
  const mail = emailRequest.safeParse(body);
  const confirmation = emailConfirm.safeParse(body);
  if (!mail.success && !confirmation.success) return respond("invalidInput", 400);

  try {
    if (confirmation.success) {
      const outcome = await confirmAccountMail(confirmation.data, request.headers);
      return respond(outcome, outcome === "invalidLink" ? 400 : 200);
    }
    if (!mail.success) return respond("invalidInput", 400);

    const mockMail = isMailMockEnabled();
    if (mockMail) {
      const traceId = randomUUID();
      const locale = await getLocale();
      console.info("account-mail-mocked", { kind: mail.data.kind, traceId, locale });
      return respond("accepted", 202, traceId);
    }

    const config = getMailConfiguration(origin);
    const ip = config ? sourceIP(request.headers.get(config.ipHeader)) : null;
    if (!ip) return respond("unavailable", 503);

    const { kind, email } = mail.data;
    const retryAfter = await reserveMailRequest(getConnection(), kind, email, ip, auth.BETTER_AUTH_SECRET);
    if (retryAfter) return respond("rateLimited", 429, undefined, retryAfter);

    const traceId = randomUUID();
    const locale = await getLocale();
    after(() => prepareAccountMail(mail.data, locale, traceId));
    return respond("accepted", 202, traceId);
  } catch {
    console.error("account-email-unavailable");
    return respond("unavailable", 503);
  }
}
