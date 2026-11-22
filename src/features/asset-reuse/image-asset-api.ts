import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  readImageAsset,
  registerImageAsset,
  registerImageAssetUse,
  revokeImageAsset,
} from "./image-asset-commands.ts";
import {
  imageAssetErrors,
  readImageAssetSchema,
  registerImageAssetSchema,
  registerImageAssetUseBodySchema,
  type ImageAssetError,
} from "./image-asset-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: ImageAssetError, traceId?: string) {
  const t = await getTranslator("imageAssets");
  return Response.json(
    { error: { code, message: t(code) }, ...(traceId ? { traceId } : {}) },
    { status: imageAssetErrors[code], headers: privateHeaders },
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
    return { error: await failure("SERVICE_UNAVAILABLE", randomUUID()) };
  }
}

function emptySearch(request: Request) {
  return new URL(request.url).searchParams.size === 0;
}

function pathId(id: string) {
  const parsed = brandIdSchema.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export async function imageAssetCreateResponse(request: Request) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  if (!emptySearch(request)) return failure("INVALID_INPUT");
  try {
    const body = registerImageAssetSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!body.success) return failure("INVALID_INPUT");
    const result = await registerImageAsset(getConnection(), gate.session.session.user.id, body.data);
    if ("error" in result) return failure(result.error);
    return json(result, 201);
  } catch {
    const traceId = randomUUID();
    console.error("image-asset-create-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function imageAssetReadResponse(request: Request, id: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  const assetId = pathId(id);
  if (!assetId) return failure("INVALID_INPUT");
  const url = new URL(request.url);
  const keys = [...new Set(url.searchParams.keys())];
  if (keys.length !== 1 || keys[0] !== "brandId") return failure("INVALID_INPUT");
  const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
  if (!brandId.success) return failure("INVALID_INPUT");
  try {
    const result = await readImageAsset(getConnection(), gate.session.session.user.id, { brandId: brandId.data, id: assetId });
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("image-asset-read-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function imageAssetUseResponse(request: Request, id: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  if (!emptySearch(request)) return failure("INVALID_INPUT");
  const assetId = pathId(id);
  if (!assetId) return failure("INVALID_INPUT");
  try {
    const body = registerImageAssetUseBodySchema.safeParse(await readBoundedJson(request, 2 * 1024));
    if (!body.success) return failure("INVALID_INPUT");
    const result = await registerImageAssetUse(getConnection(), gate.session.session.user.id, { ...body.data, id: assetId });
    if ("error" in result) return failure(result.error);
    return json(result, 201);
  } catch {
    const traceId = randomUUID();
    console.error("image-asset-use-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function imageAssetRevokeResponse(request: Request, id: string) {
  const gate = await requireSameOrigin(request);
  if ("error" in gate) return gate.error;
  if (!emptySearch(request)) return failure("INVALID_INPUT");
  const assetId = pathId(id);
  if (!assetId) return failure("INVALID_INPUT");
  try {
    const body = readImageAssetSchema.omit({ id: true }).safeParse(await readBoundedJson(request, 1024));
    if (!body.success) return failure("INVALID_INPUT");
    const result = await revokeImageAsset(getConnection(), gate.session.session.user.id, { ...body.data, id: assetId });
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("image-asset-revoke-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

