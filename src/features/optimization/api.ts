import "server-only";

import { getConnection } from "@/lib/db/connection";
import { requireSession } from "@/lib/auth/session";
import { allowsOptionalApiOrigin } from "@/lib/http/web-cors";
import { getTranslator } from "@/lib/i18n/server";
import {
  confirmActionDraft,
  dismissActionDraft,
  draftFromEvidence,
} from "./action-drafts";
import {
  checkPages,
  generateFromEvidence,
  listPrioritizedTasks,
  readTaskDetail,
  updateTask,
} from "./commands";
import {
  listTasksQuerySchema,
  optimizationErrors,
  optimizationWriteSchema,
  type OptimizationError,
} from "./contracts";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Accept-Language" };

async function errorResponse(code: OptimizationError, status = optimizationErrors[code]) {
  const t = await getTranslator("optimization");
  return Response.json({
    error: {
      code,
      message: t(code),
      retryable: status === 503,
    },
  }, { status, headers });
}

export async function optimizationListResponse(request: Request) {
  if (!allowsOptionalApiOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");

  const entries = [...new URL(request.url).searchParams.entries()];
  const query = listTasksQuerySchema.safeParse(Object.fromEntries(entries));
  if (!query.success) return errorResponse("INVALID_INPUT");

  const result = await listPrioritizedTasks(
    getConnection(),
    session.user.id,
    query.data.brandId,
    query.data.limit,
  );
  if ("error" in result) return errorResponse(result.error);
  return Response.json({ tasks: result.tasks }, { headers });
}

export async function optimizationDetailResponse(request: Request, taskId: string) {
  if (!allowsOptionalApiOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");

  const result = await readTaskDetail(getConnection(), session.user.id, taskId);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}

export async function optimizationWriteResponse(request: Request) {
  if (!allowsOptionalApiOrigin(request) || request.method !== "POST") return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_INPUT");
  }
  const parsed = optimizationWriteSchema.safeParse(body);
  if (!parsed.success) return errorResponse("INVALID_INPUT");

  const db = getConnection();
  const input = parsed.data;
  if (input.action === "generate-from-evidence") {
    const result = await generateFromEvidence(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error);
    return Response.json(result, { headers });
  }
  if (input.action === "draft-from-evidence") {
    const result = await draftFromEvidence(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error);
    return Response.json(result, { headers });
  }
  if (input.action === "confirm-action-draft") {
    const result = await confirmActionDraft(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error);
    return Response.json(result, { headers });
  }
  if (input.action === "dismiss-action-draft") {
    const result = await dismissActionDraft(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error);
    return Response.json(result, { headers });
  }
  if (input.action === "check-pages") {
    const result = await checkPages(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error);
    return Response.json(result, { headers });
  }
  const result = await updateTask(db, session.user.id, input);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}
