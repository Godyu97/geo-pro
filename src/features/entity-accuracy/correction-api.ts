import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { confirmEntityDisambiguation, recordEntityCorrection } from "./revisions.ts";
import {
  entityCorrectionBodySchema,
  entityCorrectionErrors,
  entityDisambiguationBodySchema,
  type EntityCorrectionError,
} from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

type Kind = "disambiguation" | "correction";

function messageKey(kind: Kind, code: EntityCorrectionError) {
  if (code === "INVALID_INPUT") return kind === "disambiguation" ? "disambiguationInvalid" as const : "correctionInvalid" as const;
  return code;
}

async function failure(kind: Kind, code: EntityCorrectionError, traceId?: string) {
  const t = await getTranslator("entityCorrections");
  return Response.json(
    { error: { code, message: t(messageKey(kind, code)) }, traceId },
    { status: entityCorrectionErrors[code], headers: privateHeaders },
  );
}

async function requireTrustedOrigin(request: Request, kind: Kind) {
  const session = await getSessionState();
  if (session.status !== "authenticated") {
    return { error: await failure(kind, session.status === "anonymous" ? "SESSION_REQUIRED" : "SERVICE_UNAVAILABLE") };
  }
  try {
    const origin = new URL(getAuthEnvironment().BETTER_AUTH_URL).origin;
    if (!isAllowedApiOrigin(request, origin)) return { error: await failure(kind, "FORBIDDEN") };
    return { session };
  } catch {
    return { error: await failure(kind, "SERVICE_UNAVAILABLE", randomUUID()) };
  }
}

function json(body: unknown) {
  return Response.json(body, { headers: privateHeaders });
}

type Context = { params: Promise<{ id: string }> };

export async function postEntityDisambiguation(request: Request, context: Context) {
  const gate = await requireTrustedOrigin(request, "disambiguation");
  if ("error" in gate) return gate.error;
  const brandId = brandIdSchema.safeParse((await context.params).id);
  if (!brandId.success) return failure("disambiguation", "NOT_FOUND");
  try {
    if (new URL(request.url).searchParams.size) return failure("disambiguation", "INVALID_INPUT");
    const body = entityDisambiguationBodySchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!body.success) return failure("disambiguation", "INVALID_INPUT");
    const result = await confirmEntityDisambiguation(getConnection(), gate.session.session.user.id, {
      ...body.data,
      brandId: brandId.data,
    });
    if ("error" in result && result.error) return failure("disambiguation", result.error);
    if (!("disambiguation" in result)) return failure("disambiguation", "SERVICE_UNAVAILABLE");
    return json({
      id: result.disambiguation.id,
      observationId: result.disambiguation.observationId,
      priorAnalysisId: result.disambiguation.priorAnalysisId,
      nextAnalysisId: result.disambiguation.nextAnalysisId,
      countAsTargetMention: result.disambiguation.countAsTargetMention,
      prior: result.prior,
      next: result.next,
    });
  } catch {
    const traceId = randomUUID();
    console.error("entity-disambiguation-write-unavailable", { traceId });
    return failure("disambiguation", "SERVICE_UNAVAILABLE", traceId);
  }
}

export async function postEntityCorrection(request: Request, context: Context) {
  const gate = await requireTrustedOrigin(request, "correction");
  if ("error" in gate) return gate.error;
  const brandId = brandIdSchema.safeParse((await context.params).id);
  if (!brandId.success) return failure("correction", "NOT_FOUND");
  try {
    if (new URL(request.url).searchParams.size) return failure("correction", "INVALID_INPUT");
    const body = entityCorrectionBodySchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!body.success) return failure("correction", "INVALID_INPUT");
    const result = await recordEntityCorrection(getConnection(), gate.session.session.user.id, {
      ...body.data,
      brandId: brandId.data,
    });
    if ("error" in result && result.error) return failure("correction", result.error);
    if (!("correction" in result)) return failure("correction", "SERVICE_UNAVAILABLE");
    return json(result.correction);
  } catch {
    const traceId = randomUUID();
    console.error("entity-correction-write-unavailable", { traceId });
    return failure("correction", "SERVICE_UNAVAILABLE", traceId);
  }
}
