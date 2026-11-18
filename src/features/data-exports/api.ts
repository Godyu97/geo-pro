import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandFixtureOrigin } from "@/features/brands/intake";
import { exportErrorMessage, exportFileName, exportIdSchema, exportRequestSchema, type ExportErrorCode } from "./contracts";
import { prepareExport, readExportFile } from "./service";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

const status: Record<ExportErrorCode, number> = {
  SESSION_REQUIRED: 401, SESSION_CHANGED: 409, INVALID_INPUT: 400, FORBIDDEN: 403,
  BRAND_SCOPE_CLOSED: 403, CONFLICT: 409, NOT_FOUND: 404, SERVICE_UNAVAILABLE: 503,
};

async function failure(code: ExportErrorCode) {
  const t = await getTranslator("dataExports");
  const traceId = code === "SERVICE_UNAVAILABLE" ? randomUUID() : undefined;
  if (traceId) console.error("data-export-unavailable", { traceId });
  return Response.json({ error: { code, message: t(exportErrorMessage[code]) }, traceId }, {
    status: status[code], headers: privateHeaders,
  });
}

export async function prepareExportResponse(request: Request) {
  const session = await getSessionState();
  if (session.status !== "authenticated") return failure(session.status === "anonymous" ? "SESSION_REQUIRED" : "SERVICE_UNAVAILABLE");
  try {
    const origin = new URL(getAuthEnvironment().BETTER_AUTH_URL).origin;
    if (request.headers.get("origin") !== origin) return failure("FORBIDDEN");

    const result = exportRequestSchema.safeParse(await readBoundedJson(request, 2048));
    if (!result.success) return failure("INVALID_INPUT");
    const ownerId = session.session.user.id;
    if (result.data.actorId !== ownerId) return failure("SESSION_CHANGED");
    if (result.data.scopes.includes("brands") && !brandFixtureOrigin(request.headers)) return failure("BRAND_SCOPE_CLOSED");

    const prepared = await prepareExport(getConnection(), ownerId, result.data);
    return "summary" in prepared
      ? Response.json(prepared.summary, { status: 201, headers: privateHeaders })
      : failure(prepared.error);
  } catch {
    return failure("SERVICE_UNAVAILABLE");
  }
}

export async function downloadExportResponse(request: Request, id: string) {
  const session = await getSessionState();
  if (session.status !== "authenticated") return failure(session.status === "anonymous" ? "SESSION_REQUIRED" : "SERVICE_UNAVAILABLE");
  const parsed = exportIdSchema.safeParse(id);
  if (!parsed.success || new URL(request.url).searchParams.size) return failure("NOT_FOUND");
  try {
    const file = await readExportFile(getConnection(), session.session.user.id, parsed.data, Boolean(brandFixtureOrigin(request.headers)));
    if (!file) return failure("NOT_FOUND");

    const { summary, body } = file;
    return new Response(body, {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Language": summary.locale,
        "Content-Disposition": `attachment; filename="${exportFileName({ ...summary, locale: "en" })}"; filename*=UTF-8''${encodeURIComponent(exportFileName(summary))}`,
      },
    });
  } catch {
    return failure("SERVICE_UNAVAILABLE");
  }
}
