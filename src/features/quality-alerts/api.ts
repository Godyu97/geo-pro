import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  acknowledgeQualityAlert,
  listQualityAlerts,
  recordQualityAlert,
  snoozeQualityAlert,
} from "./commands.ts";
import { qualityAlertErrors, qualityAlertWriteSchema, type QualityAlertError } from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: QualityAlertError, traceId?: string) {
  const t = await getTranslator("qualityAlerts");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: qualityAlertErrors[code], headers: privateHeaders },
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

export async function qualityAlertListResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== "brandId")) return failure("INVALID_INPUT");
  const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
  if (!brandId.success) return failure("INVALID_INPUT");
  try {
    const result = await listQualityAlerts(getConnection(), gate.session.session.user.id, brandId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("quality-alert-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function qualityAlertWriteResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 16384);
    const command = qualityAlertWriteSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const ownerId = gate.session.session.user.id;
    const connection = getConnection();
    const result = command.data.action === "record"
      ? await recordQualityAlert(connection, ownerId, command.data)
      : command.data.action === "acknowledge"
        ? await acknowledgeQualityAlert(connection, ownerId, command.data.alertId)
        : await snoozeQualityAlert(connection, ownerId, command.data.alertId);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("quality-alert-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
