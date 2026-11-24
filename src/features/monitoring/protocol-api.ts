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
  createSamplingProtocol,
  freezeSamplingProtocol,
  listSamplingProtocols,
  pinSamplingProtocol,
} from "./protocol-commands.ts";
import {
  createSamplingProtocolSchema,
  freezeSamplingProtocolSchema,
  pinSamplingProtocolSchema,
  samplingProtocolErrors,
  type SamplingProtocolError,
} from "./protocol-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: SamplingProtocolError) {
  const t = await getTranslator("samplingProtocols");
  return Response.json({ error: { code, message: t(code) } }, { status: samplingProtocolErrors[code], headers: privateHeaders });
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
    return { error: await failure("SERVICE_UNAVAILABLE") };
  }
}

function json(body: unknown) {
  return Response.json(body, { headers: privateHeaders });
}

export async function samplingProtocolListResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    return json(await listSamplingProtocols(getConnection(), gate.session.session.user.id));
  } catch (error) {
    const traceId = randomUUID();
    console.error("sampling-protocol-list-unavailable", { traceId, name: error instanceof Error ? error.name : "Error" });
    return failure("SERVICE_UNAVAILABLE");
  }
}

export async function samplingProtocolCreateResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const command = createSamplingProtocolSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!command.success) return failure("INVALID_INPUT");
    const result = await createSamplingProtocol(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch (error) {
    const traceId = randomUUID();
    console.error("sampling-protocol-create-unavailable", { traceId, name: error instanceof Error ? error.name : "Error" });
    return failure("SERVICE_UNAVAILABLE");
  }
}

export async function samplingProtocolFreezeResponse(request: Request, protocolId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  if (!brandIdSchema.safeParse(protocolId).success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const command = freezeSamplingProtocolSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!command.success) return failure("INVALID_INPUT");
    const result = await freezeSamplingProtocol(getConnection(), gate.session.session.user.id, protocolId, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch (error) {
    const traceId = randomUUID();
    console.error("sampling-protocol-freeze-unavailable", { traceId, name: error instanceof Error ? error.name : "Error" });
    return failure("SERVICE_UNAVAILABLE");
  }
}

export async function samplingProtocolPinResponse(request: Request, runId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  if (!brandIdSchema.safeParse(runId).success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const command = pinSamplingProtocolSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!command.success) return failure("INVALID_INPUT");
    const result = await pinSamplingProtocol(getConnection(), gate.session.session.user.id, runId, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch (error) {
    const traceId = randomUUID();
    console.error("sampling-protocol-pin-unavailable", { traceId, name: error instanceof Error ? error.name : "Error" });
    return failure("SERVICE_UNAVAILABLE");
  }
}
