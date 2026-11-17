import "server-only";

import { getTranslator } from "@/lib/i18n/server";
import { accessQuerySchema } from "./contracts";
import { currentMaintenanceAccess } from "./service";

export async function maintenanceAccessResponse(request: Request) {
  const entries = [...new URL(request.url).searchParams.entries()];
  const query = accessQuerySchema.safeParse(Object.fromEntries(entries));
  const invalid = !query.success || entries.length !== new Set(entries.map(([key]) => key)).size;
  const result = await currentMaintenanceAccess(query.success ? query.data.permission ?? null : null, invalid);
  const t = await getTranslator("maintenance");
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Accept-Language" };
  if (result.status === "allowed") return Response.json({ ...result.data, traceId: result.traceId }, { headers });
  const status = result.status === "unavailable" ? 503 : result.reason === "session-required" ? 401 : result.reason === "invalid-input" ? 400 : 403;
  const code = status === 503 ? "SERVICE_UNAVAILABLE" : status === 401 ? "SESSION_REQUIRED" : status === 400 ? "INVALID_INPUT" : "PERMISSION_DENIED";
  return Response.json({
    error: {
      code,
      message: t(status === 503 ? "unavailable" : status === 401 ? "sessionRequired" : status === 400 ? "invalidInput" : "denied"),
      retryable: status === 503,
      nextStep: t(status === 503 ? "retryDescription" : status === 401 ? "signInDescription" : "contactDescription"),
      externalCostPossible: false,
    },
    traceId: result.traceId,
  }, { status, headers });
}
