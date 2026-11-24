import "server-only";

import { randomUUID } from "node:crypto";
import { getAuthEnvironment } from "@/lib/auth/env";
import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { cloneContentTemplate, exportContentTemplate, listContentTemplates, updateContentTemplate } from "./template-commands.ts";
import {
  cloneContentTemplateBodySchema,
  exportContentTemplateBodySchema,
  templateErrors,
  updateContentTemplateBodySchema,
  type TemplateError,
} from "./template-contracts.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Accept-Language",
};

async function failure(code: TemplateError, traceId?: string) {
  const t = await getTranslator("contentTemplates");
  return Response.json(
    { error: { code, message: t(code) }, traceId },
    { status: templateErrors[code], headers: privateHeaders },
  );
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
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

function emptySearch(request: Request) {
  return new URL(request.url).searchParams.size === 0;
}

function pathId(id: string) {
  const parsed = brandIdSchema.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export async function contentTemplateListResponse(request: Request) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const keys = [...new Set(url.searchParams.keys())];
  if (keys.length !== 1 || keys[0] !== "brandId") return failure("INVALID_INPUT");
  const brandId = brandIdSchema.safeParse(url.searchParams.get("brandId"));
  if (!brandId.success) return failure("INVALID_INPUT");
  try {
    const listed = await listContentTemplates(getConnection(), gate.session.session.user.id, brandId.data);
    if ("error" in listed) return failure(listed.error);
    return json(listed);
  } catch {
    const traceId = randomUUID();
    console.error("content-template-list-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function contentTemplateCloneResponse(request: Request, id: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  if (!emptySearch(request)) return failure("INVALID_INPUT");
  const templateId = pathId(id);
  if (!templateId) return failure("INVALID_INPUT");
  try {
    const body = cloneContentTemplateBodySchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!body.success) return failure("INVALID_INPUT");
    const result = await cloneContentTemplate(getConnection(), gate.session.session.user.id, { ...body.data, id: templateId });
    if ("error" in result) {
      if (result.error === "GATE_REQUIRED") {
        const t = await getTranslator("contentTemplates");
        return json({ error: { code: result.error, message: t(result.error) }, reason: result.reason }, templateErrors.GATE_REQUIRED);
      }
      return failure(result.error);
    }
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("content-template-clone-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function contentTemplateExportResponse(request: Request, id: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  if (!emptySearch(request)) return failure("INVALID_INPUT");
  const templateId = pathId(id);
  if (!templateId) return failure("INVALID_INPUT");
  try {
    const body = exportContentTemplateBodySchema.safeParse(await readBoundedJson(request, 1024));
    if (!body.success) return failure("INVALID_INPUT");
    const result = await exportContentTemplate(getConnection(), gate.session.session.user.id, { ...body.data, id: templateId });
    if ("error" in result) return failure(result.error);
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("content-template-export-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}

export async function contentTemplateUpdateResponse(request: Request, id: string) {
  const gate = await requireTrustedOrigin(request);
  if ("error" in gate) return gate.error;
  if (!emptySearch(request)) return failure("INVALID_INPUT");
  const templateId = pathId(id);
  if (!templateId) return failure("INVALID_INPUT");
  try {
    const body = updateContentTemplateBodySchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!body.success) return failure("INVALID_INPUT");
    const result = await updateContentTemplate(getConnection(), gate.session.session.user.id, { ...body.data, id: templateId });
    if ("error" in result) {
      if (result.error === "GATE_REQUIRED" || result.error === "SYSTEM_READONLY") {
        const t = await getTranslator("contentTemplates");
        return json({
          error: { code: result.error, message: t(result.error) },
          ...(result.error === "GATE_REQUIRED" ? { reason: result.reason } : {}),
        }, templateErrors[result.error]);
      }
      return failure(result.error);
    }
    return json(result);
  } catch {
    const traceId = randomUUID();
    console.error("content-template-update-unavailable", { traceId });
    return failure("SERVICE_UNAVAILABLE", traceId);
  }
}
