import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { registerWhitelabelShare, revokeWhitelabelShare, viewWhitelabelShare } from "./share-commands.ts";
import { shareErrors, shareRegistrationInput, type ShareError } from "./share-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: ShareError, extra?: { traceId?: string }) {
  const t = await getTranslator("shares");
  return Response.json(
    { error: { code, message: t(code) }, ...(extra?.traceId ? { traceId: extra.traceId } : {}) },
    { status: shareErrors[code], headers: privateHeaders },
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

function shareId(value: string) {
  const parsed = brandIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function shareWriteResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 2048);
    const prepared = shareRegistrationInput(body);
    if ("error" in prepared) return failure(prepared.error);
    const result = await registerWhitelabelShare(getConnection(), gate.session.session.user.id, prepared.input);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("share-write-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

export async function shareReadResponse(request: Request, id: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const share = shareId(id);
  if (!share || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
  try {
    const result = await viewWhitelabelShare(getConnection(), gate.session.session.user.id, share);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("share-read-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}

export async function shareRevokeResponse(request: Request, id: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const share = shareId(id);
  if (!share || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
  try {
    const result = await revokeWhitelabelShare(getConnection(), gate.session.session.user.id, share);
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("share-revoke-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", { traceId });
  }
}
