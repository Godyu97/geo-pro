import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { listServiceOrders, readServiceOrder, registerServiceOrder } from "./order-commands.ts";
import { orderErrors, orderRegistrationInput, type OrderError } from "./order-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: OrderError, extra?: { traceId?: string }) {
  const t = await getTranslator("orders");
  return Response.json(
    { error: { code, message: t(code) }, ...(extra?.traceId ? { traceId: extra.traceId } : {}) },
    { status: orderErrors[code], headers: privateHeaders },
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

export async function orderWriteResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    const prepared = orderRegistrationInput(body);
    if ("error" in prepared) return failure(prepared.error);
    const result = await registerServiceOrder(getConnection(), gate.session.session.user.id, prepared.input);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("order-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

export async function orderListResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const keys = [...new Set(url.searchParams.keys())];
  const userId = gate.session.session.user.id;
  try {
    if (keys.length === 0) return json(await listServiceOrders(getConnection(), userId));
    if (keys.length !== 1 || keys[0] !== "id") return failure("INVALID_INPUT");
    const id = brandIdSchema.safeParse(url.searchParams.get("id"));
    if (!id.success) return failure("INVALID_INPUT");
    const result = await readServiceOrder(getConnection(), userId, id.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("order-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}
