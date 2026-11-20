import "server-only";

import { getConnection } from "@/lib/db/connection";
import { requireSession } from "@/lib/auth/session";
import { getTranslator } from "@/lib/i18n/server";
import {
  generateReport,
  listReports,
  readSnapshot,
  requestRetest,
  reviseReport,
} from "./commands";
import {
  listReportsQuerySchema,
  reportErrors,
  reportWriteSchema,
  type ReportError,
} from "./contracts";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Accept-Language" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function errorResponse(code: ReportError, status = reportErrors[code]) {
  const t = await getTranslator("reports");
  return Response.json({
    error: {
      code,
      message: t(code),
      retryable: false,
    },
  }, { status, headers });
}

export async function reportsListResponse(request: Request) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");

  const entries = [...new URL(request.url).searchParams.entries()];
  const query = listReportsQuerySchema.safeParse(Object.fromEntries(entries));
  if (!query.success) return errorResponse("INVALID_INPUT");

  const result = await listReports(getConnection(), session.user.id, query.data.brandId, query.data.limit);
  if ("error" in result) return errorResponse(result.error as ReportError);
  return Response.json(result, { headers });
}

export async function reportsWriteResponse(request: Request) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");

  const body = await request.json().catch(() => null);
  const parsed = reportWriteSchema.safeParse(body);
  if (!parsed.success) return errorResponse("INVALID_INPUT");

  const db = getConnection();
  const input = parsed.data;
  if (input.action === "request-retest") {
    const result = await requestRetest(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error as ReportError);
    return Response.json(result, { headers });
  }
  if (input.action === "generate-report") {
    const result = await generateReport(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error as ReportError);
    return Response.json(result, { headers });
  }
  const result = await reviseReport(db, session.user.id, input);
  if ("error" in result) return errorResponse(result.error as ReportError);
  return Response.json(result, { headers });
}

export async function reportSnapshotResponse(request: Request, snapshotId: string, format: "json" | "html" = "json") {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");

  const result = await readSnapshot(getConnection(), session.user.id, snapshotId);
  if ("error" in result) return errorResponse(result.error as ReportError);
  const { snapshot } = result;
  if (format === "html") {
    return new Response(snapshot.htmlBytes, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="report-${snapshot.id}.html"`,
      },
    });
  }
  return new Response(snapshot.jsonBytes, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="report-${snapshot.id}.json"`,
    },
  });
}
