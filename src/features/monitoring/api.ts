import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { acceptMonitoringRun, previewMonitoringRun, readMonitoringRun } from "./commands";
import { acceptRequestSchema, previewRequestSchema, runControlSchema, type MonitoringError, type MonitoringNextStep } from "./contracts";
import { MonitoringDao, type MonitoringAttemptRow } from "./dao";
import { cancelMonitoringRun, continueMonitoringRun, executeMonitoringRun, pauseMonitoringRun, reconcileMonitoringCost, redoMonitoringAnalysis } from "./execution";
import { monitoringFailureBody, monitoringSuccessCostNotice, type SamplingAttemptFact } from "./failure-contract";
import { officialSamplingPortFromEnv } from "./official-port";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { executeFunctionalMockRun } from "@/features/functional-mock/apply-run";
import { functionalMockRequested } from "@/features/functional-mock/mode";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

function samplingFacts(attempts: readonly MonitoringAttemptRow[]): SamplingAttemptFact[] {
  return attempts.map((attempt) => ({
    slotId: attempt.slotId,
    kind: attempt.kind,
    disposition: attempt.disposition,
    costState: attempt.costState,
    ordinal: attempt.ordinal,
  }));
}

async function loadSamplingFacts(ownerId: string, runId: string): Promise<SamplingAttemptFact[] | "unreadable"> {
  try {
    const dao = new MonitoringDao(getConnection());
    const run = await dao.runForOwner(ownerId, runId);
    if (!run) return [];
    return samplingFacts(await dao.attempts([run.id]));
  } catch (error) {
    console.error("monitoring-failure-context-unreadable", { name: error instanceof Error ? error.name : "unknown" });
    return "unreadable";
  }
}

async function failure(code: MonitoringError, traceId?: string, next?: MonitoringNextStep | null, facts?: SamplingAttemptFact[] | "unreadable") {
  const t = await getTranslator("monitoring");
  const built = monitoringFailureBody({
    code,
    message: t(code),
    next: next ?? null,
    translate: (key) => t(key),
    attempts: facts === "unreadable" ? [] : facts,
    costUnreadable: facts === "unreadable",
    traceId,
  });
  return Response.json(built.body, { status: built.status, headers: privateHeaders });
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
    const ownerId = gate.session.session.user.id;
    const command = runControlSchema.safeParse(body);
    if (!command.success || new URL(request.url).searchParams.size) {
      return failure("INVALID_INPUT", undefined, null, await loadSamplingFacts(ownerId, runId));
    }
    const connection = getConnection();
    const result = command.data.action === "pause" ? await pauseMonitoringRun(connection, ownerId, runId)
      : command.data.action === "continue" ? await continueMonitoringRun(connection, ownerId, runId)
        : command.data.action === "cancel" ? await cancelMonitoringRun(connection, ownerId, runId)
          : command.data.action === "execute-mock"
            ? brandIntakeOrigin(request.headers)?.mode === "mock"
              ? await executeFunctionalMockRun(connection, ownerId, runId)
              : { error: "REAL_CHANNEL_CLOSED" as const, next: "await-channel" as const }
            : command.data.action === "execute"
              ? functionalMockRequested(process.env)
                ? { error: "REAL_CHANNEL_CLOSED" as const, next: "await-channel" as const }
                : await executeMonitoringRun(connection, ownerId, runId, officialSamplingPortFromEnv())
            : command.data.action === "redo-analysis" ? await redoMonitoringAnalysis(connection, ownerId, runId, command.data.slotId)
              : await reconcileMonitoringCost(connection, ownerId, runId, command.data.attemptId, command.data.actualMinor);
    if ("error" in result) return failure(result.error, undefined, result.next, await loadSamplingFacts(ownerId, runId));
    const t = await getTranslator("monitoring");
    const notice = monitoringSuccessCostNotice(samplingFacts(result.attempts), (key) => t(key));
    return Response.json(notice ? { ...result, ...notice } : result, { headers: privateHeaders });
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-run-control-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId, null, await loadSamplingFacts(gate.session.session.user.id, runId));
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
