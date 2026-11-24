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
  arriveAtSamplingWindow,
  listSamplingPlans,
  pauseExpiredSamplingChannel,
  reviseSamplingPlanBudget,
  saveSamplingPlan,
  transitionSamplingPlan,
} from "./commands.ts";
import {
  reviseSamplingBudgetSchema,
  samplingPlanErrors,
  samplingPlanWriteSchema,
  type SamplingPlanError,
} from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: SamplingPlanError, traceId?: string) {
  const t = await getTranslator("samplingPlans");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: samplingPlanErrors[code], headers: privateHeaders },
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

export async function samplingPlanListResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== "brandId")) return failure("INVALID_INPUT");
  const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
  if (!brandId.success) return failure("INVALID_INPUT");
  try {
    const result = await listSamplingPlans(getConnection(), gate.session.session.user.id, brandId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("sampling-plan-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function samplingPlanWriteResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 32768);
    const command = samplingPlanWriteSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const ownerId = gate.session.session.user.id;
    const connection = getConnection();
    const result = command.data.action === "create"
      ? await saveSamplingPlan(connection, ownerId, command.data)
      : command.data.action === "transition"
        ? await transitionSamplingPlan(connection, ownerId, command.data)
        : command.data.action === "arrive"
          ? await arriveAtSamplingWindow(connection, ownerId, command.data)
          : await pauseExpiredSamplingChannel(connection, ownerId, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("sampling-plan-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function samplingPlanBudgetResponse(request: Request, planId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(planId);
  if (!id.success) return failure("NOT_FOUND");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 4096);
    const command = reviseSamplingBudgetSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await reviseSamplingPlanBudget(getConnection(), gate.session.session.user.id, id.data, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("sampling-plan-budget-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
