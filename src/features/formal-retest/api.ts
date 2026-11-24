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
  appendFormalConfounder,
  createFormalObservation,
  listFormalConfounders,
  listFormalControls,
  listFormalObservations,
  recordFormalCheckpoint,
  registerFormalControl,
} from "./commands.ts";
import {
  createFormalObservationSchema,
  formalObservationErrors,
  recordFormalCheckpointSchema,
  type FormalObservationError,
} from "./contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: FormalObservationError, traceId?: string) {
  const t = await getTranslator("formalObservations");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: formalObservationErrors[code], headers: privateHeaders },
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

export async function formalObservationListResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== "brandId")) return failure("INVALID_INPUT");
  const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
  if (!brandId.success) return failure("INVALID_INPUT");
  try {
    const result = await listFormalObservations(getConnection(), gate.session.session.user.id, brandId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("formal-observation-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function formalObservationCreateResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 4096);
    const command = createFormalObservationSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await createFormalObservation(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("formal-observation-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function formalCheckpointCreateResponse(request: Request, observationId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(observationId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 8192);
    const command = recordFormalCheckpointSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await recordFormalCheckpoint(getConnection(), gate.session.session.user.id, id.data, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("formal-checkpoint-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function formalConfounderListResponse(request: Request, observationId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(observationId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await listFormalConfounders(getConnection(), gate.session.session.user.id, id.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("formal-confounder-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function formalConfounderCreateResponse(request: Request, observationId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(observationId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 4096);
    const result = await appendFormalConfounder(getConnection(), gate.session.session.user.id, id.data, body);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("formal-confounder-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function formalControlListResponse(request: Request, observationId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(observationId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await listFormalControls(getConnection(), gate.session.session.user.id, id.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("formal-control-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function formalControlCreateResponse(request: Request, observationId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(observationId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 4096);
    const result = await registerFormalControl(getConnection(), gate.session.session.user.id, id.data, body);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("formal-control-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
