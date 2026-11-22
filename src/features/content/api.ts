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
  readChannelVariant,
  readChannelVariants,
  readContentVersion,
  readDeliveryPackage,
  readPublication,
  readPublicationEvidence,
  registerAsset,
  rejectContent,
  resumeBatch,
  retryFailed,
  saveBriefDraft,
  submitManualEvidence,
  submitPublication,
  submitReview,
  approveChannelVariant,
  blockChannelVariant,
  exportChannelVariant,
  saveChannelVariant,
  updateVariant,
  verifyPublication,
  type ExportBlocker,
} from "./commands";
import { openContentMaintenance, readContentCalendar, settleContentMaintenance } from "./maintenance";
import { draftContentFromBrief } from "./fact-drafts";
import { PACKAGE_FILE_NAMES } from "./package";
import {
  contentErrors,
  calendarQuerySchema,
  contentWriteSchema,
  listContentQuerySchema,
  maintenanceWriteSchema,
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

export async function channelVariantsResponse(request: Request, versionId: string) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  const result = await readChannelVariants(getConnection(), session.user.id, versionId);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}

export async function channelVariantResponse(request: Request, variantId: string) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  const result = await readChannelVariant(getConnection(), session.user.id, variantId);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}

const packageFiles = new Set<string>(PACKAGE_FILE_NAMES);

export async function contentPublicationResponse(request: Request, publicationId: string) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  const evidenceId = new URL(request.url).searchParams.get("evidence");
  if (evidenceId) {
    const screenshot = await readPublicationEvidence(getConnection(), session.user.id, publicationId, evidenceId);
    if ("error" in screenshot) return errorResponse(screenshot.error);
    const fileName = screenshot.fileName.replace(/["\r\n\\]/g, "");
    const bytes = new Uint8Array(screenshot.body.byteLength);
    bytes.set(screenshot.body);
    return new Response(bytes.buffer, {
      headers: {
        ...headers,
        "Content-Type": screenshot.contentType,
        "Content-Disposition": `attachment; filename="${fileName || "screenshot"}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  }

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

export async function contentCalendarResponse(request: Request) {
  if (!sameOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  const entries = [...new URL(request.url).searchParams.entries()];
  const query = calendarQuerySchema.safeParse(Object.fromEntries(entries));
  if (!query.success) return errorResponse("INVALID_INPUT");
  const result = await readContentCalendar(getConnection(), session.user.id, query.data);
  if ("error" in result) return errorResponse(result.error);
  return Response.json(result, { headers });
}

export async function contentMaintenanceResponse(request: Request) {
  if (!sameOrigin(request) || request.method !== "POST") return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_INPUT");
  }
  const parsed = maintenanceWriteSchema.safeParse(body);
  if (!parsed.success) return errorResponse("INVALID_INPUT");
  const db = getConnection();
  const result = parsed.data.action === "open-maintenance"
    ? await openContentMaintenance(db, session.user.id, parsed.data)
    : await settleContentMaintenance(db, session.user.id, parsed.data);
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
  if (input.action === "draft-from-facts") {
    const result = await draftContentFromBrief(db, session.user.id, input);
    if ("error" in result) return errorResponse(result.error, undefined, result.gaps);
    return Response.json(result, { headers });
  }
  if (input.action === "submit-review") return respond(await submitReview(db, session.user.id, input));
  if (input.action === "approve-content") return respond(await approveContent(db, session.user.id, input));
  if (input.action === "reject-content") return respond(await rejectContent(db, session.user.id, input));
  if (input.action === "update-variant") return respond(await updateVariant(db, session.user.id, input));
  if (input.action === "save-channel-variant") return respond(await saveChannelVariant(db, session.user.id, input));
  if (input.action === "approve-channel-variant") return respond(await approveChannelVariant(db, session.user.id, input));
  if (input.action === "block-channel-variant") return respond(await blockChannelVariant(db, session.user.id, input));
  if (input.action === "export-channel-variant") return respond(await exportChannelVariant(db, session.user.id, input));
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
