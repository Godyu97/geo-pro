import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { decideApproval, listApprovalPolicies, saveApprovalPolicy } from "./commands.ts";
import { approvalErrors, decideApprovalSchema, saveApprovalPolicySchema, type ApprovalError } from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: ApprovalError, traceId?: string) {
  const t = await getTranslator("approvalPolicy");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: approvalErrors[code], headers: privateHeaders },
  );
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
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

function emptySearch(request: Request) {
  return new URL(request.url).searchParams.size === 0;
}

export async function approvalPolicyListResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const keys = [...new Set(url.searchParams.keys())];
  if (keys.length > 1 || (keys.length === 1 && keys[0] !== "brandId")) return failure("INVALID_INPUT");
  const requested = url.searchParams.get("brandId");
  if (requested && !brandIdSchema.safeParse(requested).success) return failure("INVALID_INPUT");
  try {
    const list = await listApprovalPolicies(getConnection(), gate.session.session.user.id);
    if (!requested) return json(list);
    const policy = list.policies.find((item) => item.brandId === requested);
    if (!policy) return failure("NOT_FOUND");
    return json(policy);
  } catch {
    const traceId = randomUUID();
    console.error("approval-policy-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function approvalPolicySaveResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  if (!emptySearch(request)) return failure("INVALID_INPUT");
  try {
    const command = saveApprovalPolicySchema.safeParse(await readBoundedJson(request, 16 * 1024));
    if (!command.success) return failure("INVALID_INPUT");
    const result = await saveApprovalPolicy(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("approval-policy-save-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function approvalDecisionResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  if (!emptySearch(request)) return failure("INVALID_INPUT");
  try {
    const command = decideApprovalSchema.safeParse(await readBoundedJson(request, 1024));
    if (!command.success) return failure("INVALID_INPUT");
    const result = await decideApproval(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result) {
      if ((result.error === "SEPARATION" || result.error === "DUTY") && result.versionId && result.reason) {
        const t = await getTranslator("approvalPolicy");
        return json({
          error: { code: result.error, message: t(result.error) },
          versionId: result.versionId,
          reason: result.reason,
        }, approvalErrors[result.error]);
      }
      return failure(result.error);
    }
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("approval-decision-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
