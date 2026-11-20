import "server-only";

import { getConnection } from "@/lib/db/connection";
import { requireSession } from "@/lib/auth/session";
import { getTranslator } from "@/lib/i18n/server";
import {
  approveContent,
  cancelBatch,
  confirmBrief,
  exportConfirm,
  exportPreflight,
  generateBatch,
  listBriefs,
  markPublicationRemoved,
  pauseBatch,
  readBatch,
  readBriefDetail,
  readContentVersion,
  readDeliveryPackage,
  readPublication,
  registerAsset,
  rejectContent,
  resumeBatch,
  retryFailed,
  saveBriefDraft,
  submitManualEvidence,
  submitPublication,
  submitReview,
  updateVariant,
  verifyPublication,
  type ExportBlocker,
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

async function errorResponse(
  code: ContentError,
  status = contentErrors[code],
  gaps?: Array<{ code: string }>,
  blockers?: ExportBlocker[],
) {
  const t = await getTranslator("content");
  return Response.json({
    error: {
      code,
      message: t(code),
      retryable: status === 503,
      ...(gaps ? { gaps } : {}),
      ...(blockers ? { blockers } : {}),
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

const packageFiles = new Set([
  "content.md", "content.html", "manifest.json", "public-sources.json",
  "publish-checklist.md", "public-images.json",
]);

export async function contentPublicationResponse(request: Request, publicationId: string) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  const result = await readPublication(getConnection(), session.user.id, publicationId);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}

export async function contentPackageResponse(request: Request, packageId: string) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  const result = await readDeliveryPackage(getConnection(), session.user.id, packageId);
  if ("error" in result) return errorResponse(result.error);

  const file = new URL(request.url).searchParams.get("file");
  if (!file) return Response.json(result, { headers });
  if (!packageFiles.has(file) || !(file in result.files)) return errorResponse("NOT_FOUND");
  // Plain text + attachment: package HTML is never rendered inside this origin.
  return new Response(result.files[file], {
    headers: {
      ...headers,
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}

async function respond(result: object) {
  if ("error" in result) {
    const failure = result as { error: ContentError; gaps?: Array<{ code: string }>; blockers?: ExportBlocker[] };
    return errorResponse(failure.error, undefined, failure.gaps, failure.blockers);
  }
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
  if (input.action === "submit-review") return respond(await submitReview(db, session.user.id, input));
  if (input.action === "approve-content") return respond(await approveContent(db, session.user.id, input));
  if (input.action === "reject-content") return respond(await rejectContent(db, session.user.id, input));
  if (input.action === "update-variant") return respond(await updateVariant(db, session.user.id, input));
  if (input.action === "register-asset") return respond(await registerAsset(db, session.user.id, input));
  if (input.action === "export-preflight") return respond(await exportPreflight(db, session.user.id, input));
  if (input.action === "export-confirm") return respond(await exportConfirm(db, session.user.id, input));
  if (input.action === "submit-publication") return respond(await submitPublication(db, session.user.id, input));
  if (input.action === "verify-publication") return respond(await verifyPublication(db, session.user.id, input));
  if (input.action === "submit-manual-evidence") return respond(await submitManualEvidence(db, session.user.id, input));
  if (input.action === "mark-publication-removed") {
    return respond(await markPublicationRemoved(db, session.user.id, input));
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
