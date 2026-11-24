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
  getNotificationEndpoint,
  registerNotificationEndpoint,
  requestNotificationDelivery,
  revokeNotificationEndpoint,
} from "./commands.ts";
import {
  notificationEndpointErrors,
  registerNotificationEndpointSchema,
  requestNotificationDeliverySchema,
  revokeNotificationEndpointSchema,
  type NotificationEndpointError,
} from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: NotificationEndpointError, traceId?: string) {
  const t = await getTranslator("notificationEndpoints");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: notificationEndpointErrors[code], headers: privateHeaders },
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

export async function notificationWriteResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 4096);
    const created = registerNotificationEndpointSchema.safeParse(body);
    if (!created.success) return failure("INVALID_INPUT");
    const result = await registerNotificationEndpoint(getConnection(), gate.session.session.user.id, created.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("notification-endpoint-register-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function notificationReadResponse(request: Request, endpointId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(endpointId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await getNotificationEndpoint(getConnection(), gate.session.session.user.id, id.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("notification-endpoint-read-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function notificationRevokeResponse(request: Request, endpointId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(endpointId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 4096);
    if (!revokeNotificationEndpointSchema.safeParse(body).success) return failure("INVALID_INPUT");
    const result = await revokeNotificationEndpoint(getConnection(), gate.session.session.user.id, id.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("notification-endpoint-revoke-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function notificationDeliveryResponse(request: Request, endpointId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(endpointId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 4096);
    const command = requestNotificationDeliverySchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await requestNotificationDelivery(getConnection(), gate.session.session.user.id, id.data, command.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("notification-delivery-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
