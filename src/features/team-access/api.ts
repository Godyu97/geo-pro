import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  executeQueuedBrandAction,
  exportGrantedBrands,
  grantBrandMember,
  leaveTeam,
  listTeamGrants,
  promoteBrandMember,
  readGrantedBrand,
  revokeBrandGrant,
} from "./commands.ts";
import { grantInputSchema, teamErrors, teamExportLimit, type TeamError } from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: TeamError, traceId?: string) {
  const t = await getTranslator("teamAccess");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: teamErrors[code], headers: privateHeaders },
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
    return { error: await failure("SERVICE_UNAVAILABLE", randomUUID()) };
  }
}

function emptySearch(request: Request) {
  return new URL(request.url).searchParams.size === 0;
}

export async function teamGrantListResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const keys = [...new Set(url.searchParams.keys())];
  const userId = gate.session.session.user.id;
  try {
    if (keys.length === 0) return json(await listTeamGrants(getConnection(), userId));
    if (keys.length === 1 && keys[0] === "brandId") {
      const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
      if (!brandId.success) return failure("INVALID_INPUT");
      const result = await readGrantedBrand(getConnection(), userId, brandId.data);
      if ("error" in result && result.error) return failure(result.error);
      return json({ brandId: result.brandId, visible: result.visible });
    }
    if (keys.length === 1 && keys[0] === "export") {
      const requested = url.searchParams.getAll("export");
      if (requested.length < 1 || requested.length > teamExportLimit) return failure("INVALID_INPUT");
      if (requested.some((brandId) => !brandIdSchema.safeParse(brandId).success)) return failure("INVALID_INPUT");
      const result = await exportGrantedBrands(getConnection(), userId, requested);
      if (!result.allowed) {
        const t = await getTranslator("teamAccess");
        return json({ allowed: false, rows: [], error: { code: "FORBIDDEN", message: t("FORBIDDEN") } }, 403);
      }
      return json(result);
    }
    return failure("INVALID_INPUT");
  } catch {
    const traceId = randomUUID();
    console.error("team-grant-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function teamGrantCreateResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  if (!emptySearch(request)) return failure("INVALID_INPUT");
  try {
    const command = grantInputSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!command.success) return failure("INVALID_INPUT");
    const result = await grantBrandMember(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("team-grant-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

async function emptyCommand(request: Request) {
  if (!emptySearch(request)) return { error: await failure("INVALID_INPUT") };
  if (!request.headers.get("content-type")) return { ok: true as const };
  const body = await readBoundedJson(request, 256);
  if (!body || typeof body !== "object" || Object.keys(body).length > 0) return { error: await failure("INVALID_INPUT") };
  return { ok: true as const };
}

export async function teamGrantPromoteResponse(request: Request, grantId: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const parsedId = brandIdSchema.safeParse(grantId);
  if (!parsedId.success) return failure("INVALID_INPUT");
  const gateBody = await emptyCommand(request);
  if ("error" in gateBody) return gateBody.error;
  try {
    const result = await promoteBrandMember(getConnection(), gate.session.session.user.id, parsedId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("team-grant-promote-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function teamGrantRevokeResponse(request: Request, grantId: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const parsedId = brandIdSchema.safeParse(grantId);
  if (!parsedId.success) return failure("INVALID_INPUT");
  const gateBody = await emptyCommand(request);
  if ("error" in gateBody) return gateBody.error;
  try {
    const result = await revokeBrandGrant(getConnection(), gate.session.session.user.id, parsedId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("team-grant-revoke-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function teamActionExecuteResponse(request: Request, actionId: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const parsedId = brandIdSchema.safeParse(actionId);
  if (!parsedId.success) return failure("INVALID_INPUT");
  const gateBody = await emptyCommand(request);
  if ("error" in gateBody) return gateBody.error;
  try {
    const result = await executeQueuedBrandAction(getConnection(), gate.session.session.user.id, parsedId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("team-action-execute-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function teamLeaveResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const gateBody = await emptyCommand(request);
  if ("error" in gateBody) return gateBody.error;
  try {
    const result = await leaveTeam(getConnection(), gate.session.session.user.id);
    if (!result.allowed) return failure("CONFLICT");
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("team-leave-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
