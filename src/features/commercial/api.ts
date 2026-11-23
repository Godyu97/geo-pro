import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  expireBrandDelegation,
  executeDelegationAction,
  portfolioForUser,
  readDelegatedBrand,
  registerAgencyMember,
  registerBrandDelegation,
} from "./commands.ts";
import {
  delegationErrors,
  expireDelegationSchema,
  registerDelegationSchema,
  registerMembershipSchema,
  type DelegationError,
} from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: DelegationError, extra?: { traceId?: string; reason?: "grant" | "membership" }) {
  const t = await getTranslator("delegations");
  return Response.json(
    {
      error: { code, message: t(code) },
      ...(extra?.traceId ? { traceId: extra.traceId } : {}),
      ...(extra?.reason ? { reason: extra.reason } : {}),
    },
    { status: delegationErrors[code], headers: privateHeaders },
  );
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}

async function requireSameOrigin(request: Request) {
  const session = await getSessionState();
  if (session.status !== "authenticated") {
    return { error: await failure(session.status === "anonymous" ? "SESSION_REQUIRED" : "SERVICE_UNAVAILABLE") };
  }
  try {
    const origin = new URL(getAuthEnvironment().BETTER_AUTH_URL).origin;
    if (request.headers.get("origin") !== origin) return { error: await failure("FORBIDDEN") };
    return { session };
  } catch {
    return { error: await failure("SERVICE_UNAVAILABLE", { traceId: randomUUID() }) };
  }
}

export async function delegationWriteResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    const membership = registerMembershipSchema.safeParse(body);
    if (membership.success) {
      const result = await registerAgencyMember(getConnection(), gate.session.session.user.id, membership.data);
      if ("error" in result) return failure(result.error);
      return json(result);
    }
    const delegation = registerDelegationSchema.safeParse(body);
    if (!delegation.success) return failure("INVALID_INPUT");
    const result = await registerBrandDelegation(getConnection(), gate.session.session.user.id, delegation.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("delegation-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

export async function delegationExpireResponse(request: Request, delegationId: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(delegationId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    if (!expireDelegationSchema.safeParse(body).success) return failure("INVALID_INPUT");
    const result = await expireBrandDelegation(getConnection(), gate.session.session.user.id, id.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("delegation-expire-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

export async function delegationPortfolioResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const keys = [...new Set(url.searchParams.keys())];
  const userId = gate.session.session.user.id;
  try {
    if (keys.length === 0) return json(await portfolioForUser(getConnection(), userId));
    if (keys.length !== 1 || keys[0] !== "brandId") return failure("INVALID_INPUT");
    const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
    if (!brandId.success) return failure("INVALID_INPUT");
    const result = await readDelegatedBrand(getConnection(), userId, brandId.data);
    if ("error" in result) return failure(result.error, "reason" in result ? { reason: result.reason } : undefined);
    return json({ brandId: result.brandId, summary: result.summary, evidenceIds: result.evidenceIds, reason: result.reason });
  } catch {
    const traceId = randomUUID();
    console.error("delegation-portfolio-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

export async function delegationActionExecuteResponse(request: Request, actionId: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(actionId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    if (!expireDelegationSchema.safeParse(body).success) return failure("INVALID_INPUT");
    const result = await executeDelegationAction(getConnection(), gate.session.session.user.id, id.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("delegation-action-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}
