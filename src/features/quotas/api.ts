import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { updateQuota } from "./commands";
import { quotaChangeSchema, quotaErrors, type GrantSnapshot, type QuotaError } from "./contracts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: QuotaError, traceId?: string, current?: GrantSnapshot | null) {
  const t = await getTranslator("quotas");
  const error = { code, message: t(code), current };
  return Response.json({ error, traceId }, { status: quotaErrors[code], headers: privateHeaders });
}

export async function changeQuotaResponse(request: Request) {
  const session = await getSessionState();
  if (session.status !== "authenticated") return failure(session.status === "anonymous" ? "SESSION_REQUIRED" : "SERVICE_UNAVAILABLE");
  try {
    const origin = new URL(getAuthEnvironment().BETTER_AUTH_URL).origin;
    if (!isAllowedApiOrigin(request, origin)) return failure("FORBIDDEN");
    const command = quotaChangeSchema.safeParse(await readBoundedJson(request, 2048));
    if (!command.success || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await updateQuota(getConnection(), session.session.user.id, command.data);
    if (result.status === "unavailable") return failure("SERVICE_UNAVAILABLE", result.traceId);
    if (result.status === "denied") return failure(result.reason === "session-required" ? "SESSION_REQUIRED" : "FORBIDDEN", result.traceId);
    if ("error" in result.data) return failure(result.data.error, result.traceId, result.data.current);
    return Response.json({ ...result.data, traceId: result.traceId }, { headers: privateHeaders });
  } catch {
    const traceId = randomUUID();
    console.error("pilot-quota-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
