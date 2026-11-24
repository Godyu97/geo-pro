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
  freezeLeadValidityRule,
  listLeadQuality,
  qualifyLeadAgainstRule,
  recordLeadObservation,
  saveLeadValidityRule,
} from "./quality-commands.ts";
import {
  isQualifyLeadRule,
  leadQualityErrors,
  leadRuleCommandSchema,
  recordLeadObservationSchema,
  type LeadQualityError,
} from "./quality-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: LeadQualityError, traceId?: string) {
  const t = await getTranslator("leadQuality");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: leadQualityErrors[code], headers: privateHeaders },
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

export async function leadQualityReadResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "brandId") return failure("INVALID_INPUT");
  const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
  if (!brandId.success) return failure("INVALID_INPUT");
  try {
    const result = await listLeadQuality(getConnection(), gate.session.session.user.id, brandId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("lead-quality-read-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function leadRuleWriteResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 8 * 1024);
    const command = leadRuleCommandSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const ownerId = gate.session.session.user.id;
    const result = isQualifyLeadRule(command.data)
      ? await qualifyLeadAgainstRule(getConnection(), ownerId, command.data)
      : await saveLeadValidityRule(getConnection(), ownerId, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("lead-rule-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function leadRuleFreezeResponse(request: Request, ruleId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const parsed = brandIdSchema.safeParse(ruleId);
  if (!parsed.success || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
  try {
    const result = await freezeLeadValidityRule(getConnection(), gate.session.session.user.id, parsed.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("lead-rule-freeze-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function leadObservationWriteResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 8 * 1024);
    const command = recordLeadObservationSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await recordLeadObservation(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("lead-observation-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
