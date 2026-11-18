import "server-only";

import { isIP } from "node:net";
import { z } from "zod";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getMessages } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/locale";
import { accountAccessPath, mailLocale, type MailKind } from "./contracts";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const mailEnvironmentSchema = z.object({
  GEO_AUTH_MAIL_URL: z.url(),
  GEO_AUTH_MAIL_SECRET: z.string().min(32).max(1024).regex(/^[!-~]+$/),
  GEO_AUTH_MAIL_IP_HEADER: z.string().regex(/^x-[a-z0-9-]{1,60}$/),
});

export function getMailConfiguration(appOrigin: string) {
  const result = mailEnvironmentSchema.safeParse(process.env);
  if (!result.success) return null;
  const { GEO_AUTH_MAIL_URL, GEO_AUTH_MAIL_SECRET, GEO_AUTH_MAIL_IP_HEADER } = result.data;
  const endpoint = new URL(GEO_AUTH_MAIL_URL);
  if (endpoint.username || endpoint.password || endpoint.hash) return null;
  if (endpoint.protocol !== "https:" &&
    !(endpoint.protocol === "http:" && loopback.has(endpoint.hostname) && loopback.has(new URL(appOrigin).hostname))) return null;
  return { endpoint, secret: GEO_AUTH_MAIL_SECRET, ipHeader: GEO_AUTH_MAIL_IP_HEADER };
}

export function sourceIP(value: string | null) {
  const ip = value?.trim() ?? "";
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6 || ip.includes("%")) return null;

  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  return mapped.slice(1).flatMap((part) => {
    const value = Number.parseInt(part, 16);
    return [value >> 8, value & 255];
  }).join(".");
}

export function logMailFailure(kind: MailKind, traceId: string, stage: "prepare" | "delivery" | "cleanup") {
  console.error("account-mail-failed", { kind, traceId, stage });
}

export async function deliverAccountMail(
  kind: MailKind, email: string, token: string, returnTo: unknown, locale: Locale, traceId: string,
) {
  try {
    const origin = new URL(getAuthEnvironment().BETTER_AUTH_URL).origin;
    const config = getMailConfiguration(origin);
    if (!config) throw new Error("Mail configuration unavailable");
    const link = new URL(accountAccessPath(kind === "verify" ? "confirm" : "reset", returnTo), origin);
    link.hash = new URLSearchParams({ token }).toString();

    const messages = getMessages(locale).accountEmail;
    const subject = kind === "verify" ? messages.confirmTitle : messages.resetTitle;
    const instructions = kind === "verify" ? messages.verifyMailBody : messages.resetMailBody;
    const response = await fetch(config.endpoint, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.secret}` },
      body: JSON.stringify({ to: email, subject, text: `${instructions}\n\n${link}`, traceId }),
      signal: AbortSignal.timeout(5_000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Mail gateway refused the request");
  } catch {
    logMailFailure(kind, traceId, "delivery");
  }
}

// Better Auth puts our server-built reset landing address in callbackURL.
export async function sendResetMail({ user, url, token }: { user: { email: string }; url: string; token: string }) {
  const callback = new URL(url).searchParams.get("callbackURL");
  const target = new URL(callback ?? "/", "https://local.invalid");
  const locale = mailLocale.safeParse(target.searchParams.get("locale"));
  const traceId = z.uuid().safeParse(target.searchParams.get("traceId"));
  if (!locale.success || !traceId.success) throw new Error("Reset delivery context unavailable");
  await deliverAccountMail("reset", user.email, token, target.searchParams.get("returnTo"), locale.data, traceId.data);
}
