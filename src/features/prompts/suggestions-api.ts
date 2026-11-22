import "server-only";

import { getConnection } from "@/lib/db/connection";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { access } from "./api";
import { promptUnavailable } from "./service";
import { executePromptSuggestion, readPromptSuggestions } from "./suggestions";

type Context = { params: Promise<{ id: string }> };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

const errors = {
  invalidInput: 400, notFound: 404, conflict: 409, readOnly: 409,
  duplicate: 422, similar: 422, deactivateRequired: 422, notReady: 422,
  aiUnavailable: 503, invalidModelOutput: 422, aiFailed: 502,
} as const;

function isSuggestionError(result: object): result is { error: keyof typeof errors } {
  return "error" in result && typeof result.error === "string" && result.error in errors;
}

export async function GET(request: Request, context: Context) {
  const scope = await access(request, context);
  if (scope instanceof Response) return scope;
  try {
    const data = await readPromptSuggestions(getConnection(), scope);
    return data ? json(data) : json({ error: "notFound" }, 404);
  } catch {
    return json(promptUnavailable(), 503);
  }
}

export async function POST(request: Request, context: Context) {
  const scope = await access(request, context);
  if (scope instanceof Response) return scope;
  try {
    const result = await executePromptSuggestion(getConnection(), scope, await readBoundedJson(request, 16 * 1024));
    return isSuggestionError(result) ? json(result, errors[result.error]) : json(result);
  } catch {
    return json(promptUnavailable(), 503);
  }
}
