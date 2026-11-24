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
  draftIndustryPackQuestions,
  listIndustryPacks,
  readIndustryPack,
  readIndustryPacksForBrand,
  registerIndustryPack,
} from "./industry-pack-commands.ts";
import {
  draftIndustryPackQuestionsSchema,
  industryPackErrors,
  registerIndustryPackSchema,
  type IndustryPackError,
} from "./industry-pack-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: IndustryPackError, traceId?: string) {
  const t = await getTranslator("industryPacks");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: industryPackErrors[code], headers: privateHeaders },
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

export async function industryPackListResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  if (keys.length > 1 || (keys.length === 1 && keys[0] !== "brandId" && keys[0] !== "id")) return failure("INVALID_INPUT");
  try {
    const ownerId = gate.session.session.user.id;
    if (keys.length === 0) return json(await listIndustryPacks(getConnection(), ownerId));
    if (keys[0] === "brandId") {
      const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
      if (!brandId.success) return failure("INVALID_INPUT");
      const result = await readIndustryPacksForBrand(getConnection(), ownerId, brandId.data);
      if ("error" in result && result.error) return failure(result.error);
      return json(result);
    }
    const packId = brandIdSchema.safeParse(url.searchParams.get("id"));
    if (!packId.success) return failure("INVALID_INPUT");
    const result = await readIndustryPack(getConnection(), ownerId, packId.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("industry-pack-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function industryPackRegisterResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 8 * 1024);
    const command = registerIndustryPackSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await registerIndustryPack(getConnection(), gate.session.session.user.id, command.data);
    if ("error" in result && result.error) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("industry-pack-register-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function industryPackQuestionResponse(request: Request, packId: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const parsedId = brandIdSchema.safeParse(packId);
  if (!parsedId.success) return failure("INVALID_INPUT");
  try {
    if (new URL(request.url).searchParams.size) return failure("INVALID_INPUT");
    const body = await readBoundedJson(request, 16 * 1024);
    const command = draftIndustryPackQuestionsSchema.safeParse(body);
    if (!command.success) return failure("INVALID_INPUT");
    const result = await draftIndustryPackQuestions(getConnection(), gate.session.session.user.id, parsedId.data, command.data);
    if ("error" in result && result.error) return failure(result.error, "traceId" in result ? result.traceId : undefined);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("industry-pack-question-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
