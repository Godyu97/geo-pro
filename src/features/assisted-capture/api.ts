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
  confirmCaptureAttempt,
  createCaptureSheet,
  degradeCaptureSheet,
  recordCaptureAttempt,
} from "./commands.ts";
import {
  captureErrors,
  confirmCaptureAttemptSchema,
  createCaptureSheetSchema,
  degradeCaptureSheetSchema,
  recordCaptureAttemptSchema,
  type CaptureError,
} from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: CaptureError, traceId?: string) {
  const t = await getTranslator("assistedCapture");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: captureErrors[code], headers: privateHeaders },
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

export async function captureSheetCreateResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 16_384);
    const command = createCaptureSheetSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await createCaptureSheet(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("capture-sheet-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function captureAttemptCreateResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 1024);
    const command = recordCaptureAttemptSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await recordCaptureAttempt(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("capture-attempt-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function captureAttemptConfirmResponse(request: Request, attemptId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(attemptId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 512);
    const command = confirmCaptureAttemptSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await confirmCaptureAttempt(getConnection(), gate.session.session.user.id, id.data, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("capture-attempt-confirm-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function captureSheetDegradeResponse(request: Request, sheetId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(sheetId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 512);
    const command = degradeCaptureSheetSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await degradeCaptureSheet(getConnection(), gate.session.session.user.id, id.data, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("capture-sheet-degrade-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
