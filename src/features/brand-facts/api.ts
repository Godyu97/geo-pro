import "server-only";

import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { isAllowedApiOrigin } from "@/lib/http/web-cors";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { brandIdSchema } from "@/features/brands/contracts";
import { brandMaterialAccess } from "@/features/brands/intake";
import { executeFactCommand, factUnavailable, readFactWorkspace } from "./service";
import { workspaceParams } from "./params";

type Context = { params: Promise<{ id: string }> };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function access(request: Request, context: Context) {
  const session = await getSessionState();
  if (session.status === "anonymous") return json({ error: "signIn" }, 401);
  if (session.status !== "authenticated") return json(factUnavailable(), 503);
  const material = brandMaterialAccess(request.headers, session.session.user.email);
  if (!material.ok) return json({ error: material.error }, 403);
  if (request.method === "POST" && !isAllowedApiOrigin(request, material.origin)) return json({ error: "forbidden" }, 403);
  const id = brandIdSchema.safeParse((await context.params).id);
  if (!id.success) return json({ error: "notFound" }, 404);
  return { ownerId: session.session.user.id, brandId: id.data };
}

export async function GET(request: Request, context: Context) {
  const scope = await access(request, context);
  if (scope instanceof Response) return scope;
  const params = new URL(request.url).searchParams;
  const query = workspaceParams.safeParse(Object.fromEntries(params));
  if (!query.success || params.size !== new Set(params.keys()).size) return json({ error: "invalidInput" }, 400);
  try {
    const data = await readFactWorkspace(getConnection(), scope, query.data);
    return data ? json(data) : json({ error: "notFound" }, 404);
  } catch {
    return json(factUnavailable(), 503);
  }
}

const errors = { invalidInput: 400, notFound: 404, conflict: 409, evidenceRequired: 422, readOnly: 409 };

export async function POST(request: Request, context: Context) {
  const scope = await access(request, context);
  if (scope instanceof Response) return scope;
  try {
    const result = await executeFactCommand(getConnection(), scope, await readBoundedJson(request, 128 * 1024));
    return "error" in result ? json(result, errors[result.error]) : json(result);
  } catch {
    return json(factUnavailable(), 503);
  }
}
