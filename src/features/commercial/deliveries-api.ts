import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { acceptBrandDelivery, disputeBrandDelivery, registerBrandDelivery } from "./delivery-commands.ts";
import {
  deliveryAcceptInput,
  deliveryDisputeInput,
  deliveryErrors,
  deliveryRegistrationInput,
  type DeliveryError,
} from "./delivery-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: DeliveryError, extra?: { traceId?: string }) {
  const t = await getTranslator("deliveries");
  return Response.json(
    { error: { code, message: t(code) }, ...(extra?.traceId ? { traceId: extra.traceId } : {}) },
    { status: deliveryErrors[code], headers: privateHeaders },
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
    return { error: await failure("SERVICE_UNAVAILABLE", { traceId: randomUUID() }) };
  }
}

function deliveryId(value: string) {
  const parsed = brandIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function deliveryWriteResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    const prepared = deliveryRegistrationInput(body);
    if ("error" in prepared) return failure(prepared.error);
    const result = await registerBrandDelivery(getConnection(), gate.session.session.user.id, prepared.input);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("delivery-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

async function transitionResponse(
  request: Request,
  id: string,
  run: (userId: string, deliveryId: string, body: unknown) => Promise<{ error: DeliveryError } | { delivery: unknown }>,
) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const delivery = deliveryId(id);
  if (!delivery || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
  try {
    const body = await readBoundedJson(request, 2048);
    const result = await run(gate.session.session.user.id, delivery, body);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("delivery-transition-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

export function deliveryAcceptResponse(request: Request, id: string) {
  return transitionResponse(request, id, async (userId, deliveryId, body) => {
    const prepared = deliveryAcceptInput(body);
    if ("error" in prepared) return prepared;
    return acceptBrandDelivery(getConnection(), userId, deliveryId);
  });
}

export function deliveryDisputeResponse(request: Request, id: string) {
  return transitionResponse(request, id, async (userId, deliveryId, body) => {
    const prepared = deliveryDisputeInput(body);
    if ("error" in prepared) return prepared;
    return disputeBrandDelivery(getConnection(), userId, deliveryId, prepared.reason);
  });
}
