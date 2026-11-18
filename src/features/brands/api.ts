import "server-only";

import { z } from "zod";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { executeBrandCommand } from "./commands";
import { brandCommandSchema, brandFieldNameSchema, brandIdSchema, brandVersionParam, type BrandErrorCode, type BrandFieldName } from "./contracts";
import { brandErrorMessage } from "./error-messages";
import { brandFixtureOrigin } from "./intake";
import { brandUnavailable, readBrandData } from "./service";

const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie, Accept-Language" };
const readQuery = z.strictObject({ id: brandIdSchema, version: brandVersionParam.optional() });
const errorStatuses: Record<BrandErrorCode, number> = {
  SESSION_REQUIRED: 401, SESSION_CHANGED: 409, NOT_FOUND: 404, LIMIT_REACHED: 409,
  VERSION_CONFLICT: 409, OPERATION_CONFLICT: 409, INTAKE_CLOSED: 403, INVALID_INPUT: 400,
  FORBIDDEN: 403, SERVICE_UNAVAILABLE: 503,
  IDENTITY_UNVERIFIED: 403, REAUTH_REQUIRED: 403, RECOVERY_EXPIRED: 409,
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: responseHeaders });
}

async function fail(code: BrandErrorCode, traceId?: string, fields?: BrandFieldName[]) {
  const t = await getTranslator("brands");
  const retryable = code === "SERVICE_UNAVAILABLE";
  const nextStep = code === "SESSION_REQUIRED" || code === "SESSION_CHANGED" || code === "REAUTH_REQUIRED" ? "signInAgain"
    : code === "LIMIT_REACHED" ? "archiveFirst"
    : code === "VERSION_CONFLICT" || code === "OPERATION_CONFLICT" ? "refreshInstruction"
    : retryable ? "retryInstruction" : "reviewInstruction";
  return json({
    error: { code, message: t(brandErrorMessage[code]), retryable, nextStep: t(nextStep), externalCostPossible: false, fields },
    traceId,
  }, errorStatuses[code]);
}

export async function readBrandResponse(request: Request) {
  const session = await getSessionState();
  if (session.status !== "authenticated") return fail(session.status === "anonymous" ? "SESSION_REQUIRED" : "SERVICE_UNAVAILABLE");
  if (!brandFixtureOrigin(request.headers)) return fail("INTAKE_CLOSED");

  const params = new URL(request.url).searchParams;
  const query = readQuery.safeParse(Object.fromEntries(params));
  if (!query.success || params.size !== new Set(params.keys()).size) return fail("INVALID_INPUT");
  const { id, version } = query.data;
  const result = await readBrandData((dao) => dao.version(session.session.user.id, id, version));
  if ("unavailable" in result) return fail("SERVICE_UNAVAILABLE", result.traceId);
  return result.data ? json(result.data) : fail("NOT_FOUND");
}

export async function writeBrandResponse(request: Request) {
  const session = await getSessionState();
  if (session.status !== "authenticated") return fail(session.status === "anonymous" ? "SESSION_REQUIRED" : "SERVICE_UNAVAILABLE");
  const origin = brandFixtureOrigin(request.headers);
  if (!origin) return fail("INTAKE_CLOSED");
  if (request.headers.get("origin") !== origin) return fail("FORBIDDEN");

  const command = brandCommandSchema.safeParse(await readBoundedJson(request, 48 * 1024));
  if (!command.success) {
    const fields = new Set<BrandFieldName>();
    for (const issue of command.error.issues) {
      if (issue.path[0] !== "fields") continue;
      const field = brandFieldNameSchema.safeParse(issue.path[1]);
      if (field.success) fields.add(field.data);
    }
    return fail("INVALID_INPUT", undefined, [...fields]);
  }
  try {
    const result = await executeBrandCommand(getConnection(), session.session.user.id, command.data, {
      emailVerified: session.session.user.emailVerified,
      createdAt: session.session.session.createdAt,
    });
    return "mutation" in result ? json(result.mutation) : fail(result.error);
  } catch {
    return fail("SERVICE_UNAVAILABLE", brandUnavailable().traceId);
  }
}
