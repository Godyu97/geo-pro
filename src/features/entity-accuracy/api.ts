import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { extractBrandFactClaim } from "./claim-extract.ts";
import { listEntityReviews, recordEntityReviews } from "./commands.ts";
import { claimExtractBodySchema, claimExtractErrors, entityReviewBodySchema, entityReviewErrors, type ClaimExtractError, type EntityReviewError } from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: EntityReviewError, traceId?: string) {
  const t = await getTranslator("entityReviews");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: entityReviewErrors[code], headers: privateHeaders },
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

function json(body: unknown) {
  return Response.json(body, { headers: privateHeaders });
}

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
  const brandId = brandIdSchema.safeParse((await context.params).id);
  if (!brandId.success) return failure("NOT_FOUND");
  try {
    const result = await listEntityReviews(getConnection(), gate.session.session.user.id, brandId.data);
    if ("error" in result && result.error) return failure(result.error);
    if (!("board" in result)) return failure("SERVICE_UNAVAILABLE");
    return json(result.board);
  } catch {
    const traceId = randomUUID();
    console.error("entity-review-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function POST(request: Request, context: Context) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const brandId = brandIdSchema.safeParse((await context.params).id);
  if (!brandId.success) return failure("NOT_FOUND");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = entityReviewBodySchema.safeParse(await readBoundedJson(request, 32 * 1024));
    if (!body.success) return failure("INVALID_INPUT");
    const result = await recordEntityReviews(getConnection(), gate.session.session.user.id, {
      ...body.data,
      brandId: brandId.data,
    });
    if ("error" in result && result.error) return failure(result.error);
    if (!("board" in result)) return failure("SERVICE_UNAVAILABLE");
    return json(result.board);
  } catch {
    const traceId = randomUUID();
    console.error("entity-review-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

async function claimFailure(code: ClaimExtractError, traceId?: string) {
  const t = await getTranslator("entityReviews");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: claimExtractErrors[code], headers: privateHeaders },
  );
}

export async function extractClaims(request: Request, context: Context) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const brandId = brandIdSchema.safeParse((await context.params).id);
  if (!brandId.success) return claimFailure("NOT_FOUND");
  try {
    if (new URL(request.url).searchParams.size) return claimFailure("INVALID_INPUT");
    const body = claimExtractBodySchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!body.success) return claimFailure("INVALID_INPUT");
    const result = await extractBrandFactClaim(getConnection(), gate.session.session.user.id, brandId.data, body.data);
    if ("error" in result && result.error) return claimFailure(result.error, result.traceId);
    if (!("claim" in result)) return claimFailure("SERVICE_UNAVAILABLE");
    return json({ claim: result.claim });
  } catch {
    const traceId = randomUUID();
    console.error("brand-fact-claim-extract-unavailable", { traceId });
    return claimFailure("SERVICE_UNAVAILABLE", traceId);
  }
}
