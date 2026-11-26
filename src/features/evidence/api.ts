import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { executeAnalysisDraft } from "./analysis-drafts";
import {
  appendReferenceLink,
  ingestAdoptedObservation,
  readObservation,
  completeManualEvidence,
  reviseAnalysis,
  submitManualEvidence,
  updateCitationOwnership,
} from "./commands";
import { evidenceErrors, evidenceWriteSchema, type EvidenceError } from "./contracts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: EvidenceError, traceId?: string, next?: string | null) {
  const t = await getTranslator("evidence");
  return Response.json(
    { error: { code, message: t(code) }, next: next ?? null, traceId },
    { status: evidenceErrors[code], headers: privateHeaders },
  );
}

async function requireTrustedOrigin(request: Request) {
  const session = await getSessionState();
  if (session.status !== "authenticated") {
    return { error: await failure(session.status === "anonymous" ? "SESSION_REQUIRED" : "SERVICE_UNAVAILABLE") };
  }
  try {
    const origin = new URL(getAuthEnvironment().BETTER_AUTH_URL).origin;
    if (!isAllowedApiOrigin(request, origin)) return { error: await failure("FORBIDDEN") };
    return { session };
  } catch {
    return { error: await failure("SERVICE_UNAVAILABLE", randomUUID()) };
  }
}

export async function evidenceWriteResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    const body = await readBoundedJson(request, 32_768);
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const parsed = evidenceWriteSchema.safeParse(body);
    if (!parsed.success) return failure("INVALID_INPUT");
    const ownerId = gate.session.session.user.id;
    const connection = getConnection();
    const result = parsed.data.action === "ingest-adopted"
      ? await ingestAdoptedObservation(connection, ownerId, parsed.data)
      : parsed.data.action === "submit-manual"
        ? await submitManualEvidence(connection, ownerId, parsed.data)
        : parsed.data.action === "complete-manual"
          ? await completeManualEvidence(connection, ownerId, parsed.data)
          : parsed.data.action === "revise-analysis"
            ? await reviseAnalysis(connection, ownerId, parsed.data)
            : parsed.data.action === "update-citation"
              ? await updateCitationOwnership(connection, ownerId, parsed.data)
              : await appendReferenceLink(connection, ownerId, parsed.data);
    if (result && "error" in result && !("observation" in result)) {
      return failure(result.error, undefined, result.next);
    }
    if (result && "error" in result && result.error === "EVIDENCE_INCOMPLETE") {
      return Response.json(result, { status: evidenceErrors.EVIDENCE_INCOMPLETE, headers: privateHeaders });
    }
    return Response.json(result, { headers: privateHeaders });
  } catch {
    const traceId = randomUUID();
    console.error("evidence-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

function isDraftFailure(result: object): result is { error: EvidenceError; traceId?: string } {
  if ("observation" in result || !("error" in result) || typeof result.error !== "string") return false;
  return Object.hasOwn(evidenceErrors, result.error);
}

export async function analysisDraftResponse(request: Request, observationId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await executeAnalysisDraft(
      getConnection(),
      gate.session.session.user.id,
      observationId,
      await readBoundedJson(request, 8_192),
    );
    if (isDraftFailure(result)) {
      const traceId = "traceId" in result && typeof result.traceId === "string" ? result.traceId : undefined;
      return failure(result.error, traceId);
    }
    return Response.json(result, { headers: privateHeaders });
  } catch {
    const traceId = randomUUID();
    console.error("analysis-draft-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function evidenceReadResponse(request: Request, observationId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await readObservation(getConnection(), gate.session.session.user.id, observationId);
    if (!result) return failure("NOT_FOUND");
    return Response.json(result, { headers: privateHeaders });
  } catch {
    const traceId = randomUUID();
    console.error("evidence-read-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
