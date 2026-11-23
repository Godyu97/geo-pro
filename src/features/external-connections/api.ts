import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  registerExternalConnection,
  retryExternalAction,
  submitExternalAction,
  updateExternalConnection,
} from "./commands.ts";
import {
  externalConnectionErrors,
  registerConnectionSchema,
  retryActionSchema,
  submitActionSchema,
  updateConnectionSchema,
  type ExternalConnectionError,
} from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: ExternalConnectionError, traceId?: string) {
  const t = await getTranslator("externalConnections");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: externalConnectionErrors[code], headers: privateHeaders },
  );
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

function json(body: unknown) {
  return Response.json(body, { headers: privateHeaders });
}

export async function connectionWriteResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    const created = registerConnectionSchema.safeParse(body);
    if (created.success) {
      const result = await registerExternalConnection(getConnection(), gate.session.session.user.id, created.data);
      if ("error" in result) return failure(result.error);
      return json(result);
    }
    const updated = updateConnectionSchema.safeParse(body);
    if (!updated.success) return failure("INVALID_INPUT");
    const result = await updateExternalConnection(getConnection(), gate.session.session.user.id, updated.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("external-connection-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function connectionActionResponse(request: Request, connectionId: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(connectionId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    const command = submitActionSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await submitExternalAction(getConnection(), gate.session.session.user.id, id.data, command.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("external-action-submit-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function connectionRetryResponse(request: Request, connectionId: string, actionId: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const connection = brandIdSchema.safeParse(connectionId);
  const action = brandIdSchema.safeParse(actionId);
  if (!connection.success || !action.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    const command = retryActionSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await retryExternalAction(
      getConnection(),
      gate.session.session.user.id,
      connection.data,
      action.data,
      command.data,
    );
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("external-action-retry-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
