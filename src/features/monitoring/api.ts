import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { acceptMonitoringRun, previewMonitoringRun, readMonitoringRun } from "./commands";
import { acceptRequestSchema, monitoringErrors, previewRequestSchema, runControlSchema, type MonitoringError } from "./contracts";
import { cancelMonitoringRun, continueMonitoringRun, executeMonitoringRun, pauseMonitoringRun, reconcileMonitoringCost, redoMonitoringAnalysis } from "./execution";
import { officialSamplingPortFromEnv } from "./official-port";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { executeFunctionalMockRun } from "@/features/functional-mock/apply-run";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: MonitoringError, traceId?: string, next?: string | null) {
  const t = await getTranslator("monitoring");
  return Response.json(
    { error: { code, message: t(code) }, next: next ?? null, traceId },
    { status: monitoringErrors[code], headers: privateHeaders },
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
    return { session, secret: getAuthEnvironment().BETTER_AUTH_SECRET };
  } catch {
    return { error: await failure("SERVICE_UNAVAILABLE", randomUUID()) };
  }
}

export async function monitoringRunResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    const body = await readBoundedJson(request, 8192);
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const preview = previewRequestSchema.safeParse(body);
    const accept = acceptRequestSchema.safeParse(body);
    const ownerId = gate.session.session.user.id;
    const result = preview.success
      ? await previewMonitoringRun(getConnection(), ownerId, preview.data, gate.secret)
      : accept.success
        ? await acceptMonitoringRun(getConnection(), ownerId, accept.data, gate.secret)
        : null;
    if (!result) return failure("INVALID_INPUT");
    if ("error" in result) return failure(result.error, undefined, result.next);
    return Response.json(result, { headers: privateHeaders });
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-run-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function monitoringRunControlResponse(request: Request, runId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    const body = await readBoundedJson(request, 8192);
    const command = runControlSchema.safeParse(body);
    if (!command.success || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const ownerId = gate.session.session.user.id;
    const connection = getConnection();
    const result = command.data.action === "pause" ? await pauseMonitoringRun(connection, ownerId, runId)
      : command.data.action === "continue" ? await continueMonitoringRun(connection, ownerId, runId)
        : command.data.action === "cancel" ? await cancelMonitoringRun(connection, ownerId, runId)
          : command.data.action === "execute-mock"
            ? brandIntakeOrigin(request.headers)?.mode === "mock"
              ? await executeFunctionalMockRun(connection, ownerId, runId)
              : { error: "REAL_CHANNEL_CLOSED" as const, next: "await-channel" as const }
            : command.data.action === "execute"
              ? await executeMonitoringRun(connection, ownerId, runId, officialSamplingPortFromEnv())
            : command.data.action === "redo-analysis" ? await redoMonitoringAnalysis(connection, ownerId, runId, command.data.slotId)
              : await reconcileMonitoringCost(connection, ownerId, runId, command.data.attemptId, command.data.actualMinor);
    if ("error" in result) return failure(result.error, undefined, result.next);
    return Response.json(result, { headers: privateHeaders });
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-run-control-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function monitoringRunReadResponse(request: Request, runId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
  const result = await readMonitoringRun(getConnection(), gate.session.session.user.id, runId);
  if ("error" in result) return failure(result.error);
  return Response.json({ run: result }, { headers: privateHeaders });
}
