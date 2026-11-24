import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  readServiceEntitlement,
  recordEntitlementUsage,
  registerServiceEntitlement,
  reviseServiceEntitlement,
  listServiceEntitlements,
} from "./entitlement-commands.ts";
import {
  entitlementErrors,
  entitlementRegistrationInput,
  entitlementRevisionInput,
  entitlementUsageInput,
  type EntitlementError,
} from "./entitlement-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: EntitlementError, extra?: { traceId?: string }) {
  const t = await getTranslator("entitlements");
  return Response.json(
    { error: { code, message: t(code) }, ...(extra?.traceId ? { traceId: extra.traceId } : {}) },
    { status: entitlementErrors[code], headers: privateHeaders },
  );
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
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
    return { error: await failure("SERVICE_UNAVAILABLE", { traceId: randomUUID() }) };
  }
}

function entitlementId(value: string) {
  const parsed = brandIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function entitlementWriteResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    const prepared = entitlementRegistrationInput(body);
    if ("error" in prepared) return failure(prepared.error);
    const result = await registerServiceEntitlement(getConnection(), gate.session.session.user.id, prepared.input);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("entitlement-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

export async function entitlementListResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const keys = [...new Set(url.searchParams.keys())];
  const userId = gate.session.session.user.id;
  try {
    if (keys.length === 0) return json(await listServiceEntitlements(getConnection(), userId));
    if (keys.length !== 1 || keys[0] !== "id") return failure("INVALID_INPUT");
    const id = brandIdSchema.safeParse(url.searchParams.get("id"));
    if (!id.success) return failure("INVALID_INPUT");
    const result = await readServiceEntitlement(getConnection(), userId, id.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("entitlement-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

export async function entitlementReviseResponse(request: Request, id: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const entitlement = entitlementId(id);
  if (!entitlement || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
  try {
    const body = await readBoundedJson(request, 2048);
    const prepared = entitlementRevisionInput(body);
    if ("error" in prepared) return failure(prepared.error);
    const result = await reviseServiceEntitlement(getConnection(), gate.session.session.user.id, entitlement, prepared.input);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("entitlement-revise-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

export async function entitlementUsageResponse(request: Request, id: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const entitlement = entitlementId(id);
  if (!entitlement || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
  try {
    const body = await readBoundedJson(request, 2048);
    const prepared = entitlementUsageInput(body);
    if ("error" in prepared) return failure(prepared.error);
    const result = await recordEntitlementUsage(getConnection(), gate.session.session.user.id, entitlement, prepared.input);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("entitlement-usage-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}
