import "server-only";

import { getTranslator } from "@/lib/i18n/server";
import { supportQuerySchema } from "./contracts";
import { lookupSupport } from "./service";

export async function supportResponse(request: Request) {
  const entries = [...new URL(request.url).searchParams.entries()];
  const duplicate = entries.length !== new Set(entries.map(([key]) => key)).size;
  const query = supportQuerySchema.safeParse(Object.fromEntries(entries));
  const invalid = duplicate || !query.success || entries.some(([key]) => key !== "operationId");
  const result = await lookupSupport(query.success ? query.data.operationId : null, invalid);
  const t = await getTranslator("support");
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Accept-Language" };
  if (result.status === "allowed") {
    return Response.json({ matches: result.data.matches, cache: result.cache ?? "blocked", traceId: result.traceId }, { headers });
  }
  const status = result.status === "unavailable" ? 503 : result.reason === "session-required" ? 401 : result.reason === "invalid-input" ? 400 : 403;
  const code = status === 503 ? "SERVICE_UNAVAILABLE" : status === 401 ? "SESSION_REQUIRED" : status === 400 ? "INVALID_INPUT" : "PERMISSION_DENIED";
  return Response.json({
    error: {
      code,
      message: t(status === 503 ? "unavailable" : status === 401 ? "sessionRequired" : status === 400 ? "invalidInput" : "denied"),
      retryable: status === 503,
      nextStep: t(status === 503 ? "retryDescription" : status === 401 ? "signInDescription" : "contactDescription"),
    },
    traceId: result.traceId,
  }, { status, headers });
}
