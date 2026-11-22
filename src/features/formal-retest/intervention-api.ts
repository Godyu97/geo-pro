import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { createInterventionBatch, getInterventionBatch, registerInterventionPage } from "./intervention-commands.ts";
import {
  createInterventionBatchSchema,
  interventionBatchErrors,
  registerInterventionPageSchema,
  type InterventionBatchError,
} from "./intervention-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: InterventionBatchError, traceId?: string) {
  const t = await getTranslator("interventionBatches");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: interventionBatchErrors[code], headers: privateHeaders },
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

export async function interventionBatchCreateResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 1024);
    const command = createInterventionBatchSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await createInterventionBatch(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("intervention-batch-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function interventionBatchReadResponse(request: Request, batchId: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(batchId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const result = await getInterventionBatch(getConnection(), gate.session.session.user.id, id.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("intervention-batch-read-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function interventionPageSaveResponse(request: Request, batchId: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const id = brandIdSchema.safeParse(batchId);
  if (!id.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    const command = registerInterventionPageSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await registerInterventionPage(getConnection(), gate.session.session.user.id, id.data, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("intervention-page-save-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
