import "server-only";

import { getConnection } from "@/lib/db/connection";
import { requireSession } from "@/lib/auth/session";
import { getTranslator } from "@/lib/i18n/server";
import {
  cancelBatch,
  confirmBrief,
  generateBatch,
  listBriefs,
  pauseBatch,
  readBatch,
  readBriefDetail,
  readContentVersion,
  resumeBatch,
  retryFailed,
  saveBriefDraft,
} from "./commands";
import {
  contentErrors,
  contentWriteSchema,
  listContentQuerySchema,
  type ContentError,
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

async function errorResponse(code: ContentError, status = contentErrors[code], gaps?: Array<{ code: string }>) {
  const t = await getTranslator("content");
  return Response.json({
    error: {
      code,
      message: t(code),
      retryable: status === 503,
      ...(gaps ? { gaps } : {}),
    },
  }, { status, headers });
}

export async function contentListResponse(request: Request) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");

  const entries = [...new URL(request.url).searchParams.entries()];
  const query = listContentQuerySchema.safeParse(Object.fromEntries(entries));
  if (!query.success) return errorResponse("INVALID_INPUT");

  const result = await listBriefs(getConnection(), session.user.id, query.data.brandId, query.data.limit);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}

export async function contentBriefResponse(request: Request, briefId: string) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  const result = await readBriefDetail(getConnection(), session.user.id, briefId);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}

export async function contentBatchResponse(request: Request, batchId: string) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  const result = await readBatch(getConnection(), session.user.id, batchId);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}

export async function contentVersionResponse(request: Request, versionId: string) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  const result = await readContentVersion(getConnection(), session.user.id, versionId);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}

export async function contentWriteResponse(request: Request) {
  if (!sameOrigin(request) || request.method !== "POST") return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_INPUT");
  }
  const parsed = contentWriteSchema.safeParse(body);
  if (!parsed.success) return errorResponse("INVALID_INPUT");

  const db = getConnection();
  const input = parsed.data;
  if (input.action === "save-brief-draft") {
    const result = await saveBriefDraft(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error, undefined, result.gaps);
    return Response.json(result, { headers });
  }
  if (input.action === "confirm-brief") {
    const result = await confirmBrief(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error, undefined, result.gaps);
    return Response.json(result, { headers });
  }
  if (input.action === "generate-batch") {
    const result = await generateBatch(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error, undefined, result.gaps);
    return Response.json(result, { headers });
  }
  if (input.action === "pause-batch") {
    const result = await pauseBatch(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error);
    return Response.json(result, { headers });
  }
  if (input.action === "resume-batch") {
    const result = await resumeBatch(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error);
    return Response.json(result, { headers });
  }
  if (input.action === "cancel-batch") {
    const result = await cancelBatch(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error);
    return Response.json(result, { headers });
  }
  const result = await retryFailed(db, session.user.id, input);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}
