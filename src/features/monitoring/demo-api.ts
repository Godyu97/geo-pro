import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { listDemoObservations, recordDemoObservation } from "./demo-commands.ts";
import {
  createDemoObservationSchema,
  demoErrors,
  type DemoError,
} from "./demo-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

export function demoErrorResponse(code: DemoError, message: string) {
  return Response.json({ error: { code, message } }, { status: demoErrors[code], headers: privateHeaders });
}

async function failure(code: DemoError) {
  const t = await getTranslator("demoObservations");
  return demoErrorResponse(code, t(code));
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
    return { error: await failure("SERVICE_UNAVAILABLE") };
  }
}

function json(body: unknown) {
  return Response.json(body, { headers: privateHeaders });
}

export async function demoListResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    const url = new URL(request.url);
    const brandId = url.searchParams.get("brandId");
    if (url.searchParams.size !== 1 || !brandIdSchema.safeParse(brandId).success || !brandId) return failure("INVALID_INPUT");
    const result = await listDemoObservations(getConnection(), gate.session.session.user.id, brandId);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch (error) {
    const traceId = randomUUID();
    console.error("demo-list-unavailable", { traceId, name: error instanceof Error ? error.name : "Error" });
    return failure("SERVICE_UNAVAILABLE");
  }
}

export async function demoCreateResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const command = createDemoObservationSchema.safeParse(await readBoundedJson(request, 48 * 1024));
    if (!command.success) return failure("INVALID_INPUT");
    const result = await recordDemoObservation(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch (error) {
    const traceId = randomUUID();
    console.error("demo-create-unavailable", { traceId, name: error instanceof Error ? error.name : "Error" });
    return failure("SERVICE_UNAVAILABLE");
  }
}
