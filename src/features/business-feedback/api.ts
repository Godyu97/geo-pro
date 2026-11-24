import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { importBusinessLeads, listBusinessLeads, readBusinessLead } from "./commands.ts";
import {
  businessLeadErrors,
  importBusinessLeadsSchema,
  type BusinessLeadError,
} from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: BusinessLeadError, traceId?: string) {
  const t = await getTranslator("businessLeads");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: businessLeadErrors[code], headers: privateHeaders },
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

export async function businessLeadListResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || (keys[0] !== "brandId" && keys[0] !== "id")) return failure("INVALID_INPUT");
  try {
    const ownerId = gate.session.session.user.id;
    if (keys[0] === "id") {
      const leadId = brandIdSchema.safeParse(url.searchParams.get("id"));
      if (!leadId.success) return failure("INVALID_INPUT");
      const result = await readBusinessLead(getConnection(), ownerId, leadId.data);
      if ("error" in result && result.error) return failure(result.error);
      return json(result);
    }
    const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
    if (!brandId.success) return failure("INVALID_INPUT");
    const result = await listBusinessLeads(getConnection(), ownerId, brandId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("business-lead-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function businessLeadImportResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 32 * 1024);
    const command = importBusinessLeadsSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await importBusinessLeads(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("business-lead-import-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
