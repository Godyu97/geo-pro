import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { evidenceErrors, type EvidenceError } from "./contracts";
import { readEvidenceOverview } from "./overview-commands";
import { overviewQuerySchema } from "./overview-contracts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: EvidenceError, traceId?: string) {
  const t = await getTranslator("evidence");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: evidenceErrors[code], headers: privateHeaders },
  );
}

export async function evidenceOverviewResponse(request: Request) {
  const session = await getSessionState();
  if (session.status !== "authenticated") {
    return failure(session.status === "anonymous" ? "SESSION_REQUIRED" : "SERVICE_UNAVAILABLE");
  }
  try {
    const origin = new URL(getAuthEnvironment().BETTER_AUTH_URL).origin;
    if (request.headers.get("origin") && request.headers.get("origin") !== origin) {
      return failure("FORBIDDEN");
    }
    const url = new URL(request.url);
    const parsed = overviewQuerySchema.safeParse({
      brandId: url.searchParams.get("brandId") ?? undefined,
      sourceMode: url.searchParams.get("sourceMode") ?? undefined,
      region: url.searchParams.get("region") || undefined,
      requestedNetworkMode: url.searchParams.get("requestedNetworkMode") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
      hasOfficialWebsite: url.searchParams.has("hasOfficialWebsite")
        ? url.searchParams.get("hasOfficialWebsite") === "1"
        : undefined,
    });
    if (!parsed.success) return failure("INVALID_INPUT");
    const result = await readEvidenceOverview(getConnection(), session.session.user.id, parsed.data);
    if ("error" in result) return failure(result.error);
    return Response.json(result, { headers: privateHeaders });
  } catch {
    const traceId = randomUUID();
    console.error("evidence-overview-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
