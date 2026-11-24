import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { pullSyncAuthorization, registerSyncAuthorization, revokeSyncAuthorization } from "./revocation-commands.ts";
import {
  registerSyncAuthorizationSchema,
  syncAuthorizationErrors,
  type SyncAuthorizationError,
} from "./revocation-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

const emptyBody = {};

async function failure(code: SyncAuthorizationError, traceId?: string) {
  const t = await getTranslator("syncAuthorizations");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: syncAuthorizationErrors[code], headers: privateHeaders },
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

export async function syncAuthorizationCreateResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 4 * 1024);
    const created = registerSyncAuthorizationSchema.safeParse(body);
    if (!created.success) return failure("INVALID_INPUT");
    const result = await registerSyncAuthorization(getConnection(), gate.session.session.user.id, created.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("sync-authorization-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

async function commandResponse(
  request: Request,
  authorizationId: string,
  run: (ownerId: string, id: string) => Promise<{ authorization: unknown } | { error: SyncAuthorizationError }>,
  logLabel: string,
) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(authorizationId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 256);
    if (JSON.stringify(body) !== JSON.stringify(emptyBody)) return failure("INVALID_INPUT");
    const result = await run(gate.session.session.user.id, id.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error(logLabel, { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export function syncAuthorizationRevokeResponse(request: Request, authorizationId: string) {
  return commandResponse(
    request,
    authorizationId,
    (ownerId, id) => revokeSyncAuthorization(getConnection(), ownerId, id),
    "sync-authorization-revoke-unavailable",
  );
}

export function syncAuthorizationPullResponse(request: Request, authorizationId: string) {
  return commandResponse(
    request,
    authorizationId,
    (ownerId, id) => pullSyncAuthorization(getConnection(), ownerId, id),
    "sync-authorization-pull-unavailable",
  );
}
