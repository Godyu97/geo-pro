import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { confirmFormalRun, recordCapability, saveAnswerNetwork } from "./commands";
import {
  answerNetworkInputSchema,
  capabilityChangeSchema,
  capabilityErrors,
  formalRunSchema,
  type CapabilityError,
} from "./contracts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: CapabilityError, traceId?: string, extra?: Record<string, unknown>) {
  const t = await getTranslator("capabilities");
  return Response.json(
    { error: { code, message: t(code) }, traceId, ...extra },
    { status: capabilityErrors[code], headers: privateHeaders },
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

export async function changeCapabilityResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    const command = capabilityChangeSchema.safeParse(await readBoundedJson(request, 8192));
    if (!command.success || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await recordCapability(getConnection(), gate.session.session.user.id, command.data);
    if (result.status === "unavailable") return failure("SERVICE_UNAVAILABLE", result.traceId);
    if (result.status === "denied") return failure(result.reason === "session-required" ? "SESSION_REQUIRED" : "FORBIDDEN", result.traceId);
    if ("error" in result.data) {
      return failure(result.data.error, result.traceId, { current: result.data.current ?? null });
    }
    return Response.json({ ...result.data, traceId: result.traceId }, { headers: privateHeaders });
  } catch {
    const traceId = randomUUID();
    console.error("capability-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function confirmFormalRunResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    const command = formalRunSchema.safeParse(await readBoundedJson(request, 2048));
    if (!command.success || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await confirmFormalRun(getConnection(), gate.session.session.user.id, command.data);
    if (result.status === "unavailable") return failure("SERVICE_UNAVAILABLE");
    if (result.reason === "CHANNEL_UNVERIFIED") {
      return failure("CHANNEL_UNVERIFIED", undefined, { denials: result.denials, eligible: false });
    }
    return Response.json(
      { eligible: result.eligible, space: result.space, denials: result.denials, reason: result.reason },
      { status: result.space === "formal" ? capabilityErrors.RUN_NOT_OPEN : 200, headers: privateHeaders },
    );
  } catch {
    const traceId = randomUUID();
    console.error("capability-run-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function saveAnswerNetworkResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    const command = answerNetworkInputSchema.safeParse(await readBoundedJson(request, 2048));
    if (!command.success || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await saveAnswerNetwork(getConnection(), gate.session.session.user.id, command.data);
    if (result.status === "unavailable") return failure("SERVICE_UNAVAILABLE");
    if (result.status === "denied") return failure(result.error);
    return Response.json({ record: result.record }, { headers: privateHeaders });
  } catch {
    const traceId = randomUUID();
    console.error("capability-network-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
