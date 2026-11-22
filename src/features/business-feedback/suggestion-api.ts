import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { decideLeadSuggestion, draftLeadSuggestions, listLeadSuggestions } from "./suggestion-commands.ts";
import {
  decideLeadSuggestionSchema,
  draftLeadSuggestionsSchema,
  leadSuggestionErrors,
  type LeadSuggestionError,
} from "./suggestion-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: LeadSuggestionError, traceId?: string) {
  const t = await getTranslator("leadSuggestions");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: leadSuggestionErrors[code], headers: privateHeaders },
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

function traceOf(result: { traceId?: string }) {
  return result.traceId;
}

export async function leadSuggestionListResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "brandId") return failure("INVALID_INPUT");
  const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
  if (!brandId.success) return failure("INVALID_INPUT");
  try {
    const result = await listLeadSuggestions(getConnection(), gate.session.session.user.id, brandId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("lead-suggestion-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function leadSuggestionDraftResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 8 * 1024);
    const command = draftLeadSuggestionsSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await draftLeadSuggestions(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error, traceOf(result));
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("lead-suggestion-draft-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function leadSuggestionDecideResponse(request: Request, suggestionId: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const parsedId = brandIdSchema.safeParse(suggestionId);
  if (!parsedId.success || new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
  try {
    const body = await readBoundedJson(request, 1024);
    const command = decideLeadSuggestionSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await decideLeadSuggestion(
      getConnection(),
      gate.session.session.user.id,
      parsedId.data,
      command.data,
    );
    if ("error" in result && result.error) return failure(result.error, traceOf(result));
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("lead-suggestion-decide-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
