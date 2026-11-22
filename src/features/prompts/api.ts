import "server-only";

import { getSessionState } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { brandIdSchema } from "@/features/brands/contracts";
import { brandMaterialOrigin } from "@/features/brands/intake";
import { executePromptCommand, promptUnavailable, readPromptWorkspace } from "./service";
import { workspaceParams } from "./params";

type Context = { params: Promise<{ id: string }> };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function access(request: Request, context: Context) {
  const session = await getSessionState();
  if (session.status === "anonymous") return json({ error: "signIn" }, 401);
  if (session.status !== "authenticated") return json(promptUnavailable(), 503);
  const origin = brandMaterialOrigin(request.headers);
  if (!origin) return json({ error: "closed" }, 403);
  if (request.method === "POST" && origin !== request.headers.get("origin")) return json({ error: "forbidden" }, 403);
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
    const data = await readPromptWorkspace(getConnection(), scope, query.data);
    return data ? json(data) : json({ error: "notFound" }, 404);
  } catch {
    return json(promptUnavailable(), 503);
  }
}

const errors = {
  invalidInput: 400, notFound: 404, conflict: 409, readOnly: 409,
  duplicate: 422, similar: 422, deactivateRequired: 422, notReady: 422,
};

export async function POST(request: Request, context: Context) {
  const scope = await access(request, context);
  if (scope instanceof Response) return scope;
  try {
    const result = await executePromptCommand(getConnection(), scope, await readBoundedJson(request, 128 * 1024));
    return "error" in result ? json(result, errors[result.error]) : json(result);
  } catch {
    return json(promptUnavailable(), 503);
  }
}
