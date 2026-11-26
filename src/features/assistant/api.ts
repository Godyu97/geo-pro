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
  confirmPlanItems, draftWeeklyPlan, executeConfirmedPlan, listAssistantPlans,
  readAssistantPlanReview, saveAssistantPlanReview,
} from "./commands.ts";
import {
  assistantErrors,
  confirmAssistantPlanSchema,
  createAssistantPlanSchema,
  type AssistantError,
} from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: AssistantError, traceId?: string) {
  const t = await getTranslator("assistant");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: assistantErrors[code], headers: privateHeaders },
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

export async function assistantPlanListResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== "brandId")) return failure("INVALID_INPUT");
  const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
  if (!brandId.success) return failure("INVALID_INPUT");
  try {
    const result = await listAssistantPlans(getConnection(), gate.session.session.user.id, brandId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("assistant-plan-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function assistantPlanCreateResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 16_384);
    const command = createAssistantPlanSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await draftWeeklyPlan(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error, "traceId" in result ? result.traceId : undefined);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("assistant-plan-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function assistantPlanConfirmResponse(request: Request, planId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  if (!brandIdSchema.safeParse(planId).success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    const command = confirmAssistantPlanSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await confirmPlanItems(getConnection(), gate.session.session.user.id, planId, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("assistant-plan-confirm-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function assistantPlanExecuteResponse(request: Request, planId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  if (!brandIdSchema.safeParse(planId).success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await executeConfirmedPlan(getConnection(), gate.session.session.user.id, planId);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("assistant-plan-execute-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function assistantPlanReviewResponse(request: Request, planId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  if (new URL(request.url).searchParams.size || !brandIdSchema.safeParse(planId).success) {
    return failure("INVALID_INPUT");
  }
  const ownerId = gate.session.session.user.id;
  try {
    const db = getConnection();
    const result = request.method === "POST"
      ? await saveAssistantPlanReview(db, ownerId, planId, await readBoundedJson(request, 8192))
      : await readAssistantPlanReview(db, ownerId, planId);
    return "error" in result ? failure(result.error) : json(result);
  } catch {
    const traceId = randomUUID();
    console.error("assistant-plan-review-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
