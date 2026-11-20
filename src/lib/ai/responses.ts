import "server-only";

import { z } from "zod";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

function trimToUndefined(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isValidHttpUrl(value: string) {
  const parsed = URL.parse(value);
  return Boolean(
    parsed &&
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash,
  );
}

const aiEnvironmentSchema = z.object({
  OPENAI_BASE_URL: z.url().refine(isValidHttpUrl).default(DEFAULT_OPENAI_BASE_URL),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).optional(),
});

export type AiEnvironment = {
  baseUrl: string;
  apiKey: string;
  defaultModel?: string;
};

export function parseAiEnvironment(env: Record<string, string | undefined> = process.env) {
  return aiEnvironmentSchema.safeParse({
    OPENAI_BASE_URL: trimToUndefined(env.OPENAI_BASE_URL),
    OPENAI_API_KEY: trimToUndefined(env.OPENAI_API_KEY),
    OPENAI_MODEL: trimToUndefined(env.OPENAI_MODEL),
  });
}

export function isAiConfigured(env: Record<string, string | undefined> = process.env) {
  return parseAiEnvironment(env).success;
}

export function getAiEnvironment(env: Record<string, string | undefined> = process.env): AiEnvironment {
  const parsed = parseAiEnvironment(env);
  if (!parsed.success) {
    throw new Error("AI configuration is incomplete; check server environment variables.");
  }
  return {
    baseUrl: parsed.data.OPENAI_BASE_URL.replace(/\/+$/, ""),
    apiKey: parsed.data.OPENAI_API_KEY,
    defaultModel: parsed.data.OPENAI_MODEL,
  };
}

export function buildResponsesUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/responses`;
}

export type ResponseInputItem = Record<string, unknown>;

export type CreateAiResponseInput = {
  model?: string;
  input: string | ResponseInputItem[];
  instructions?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: unknown;
  text?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
  store?: boolean;
  metadata?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type AiResponseUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AiResponseAnnotation = Record<string, unknown>;

const responseContentPartSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  annotations: z.array(z.record(z.string(), z.unknown())).optional(),
});

const responseOutputItemSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  status: z.string().optional(),
  role: z.string().optional(),
  content: z.array(responseContentPartSchema).optional(),
});

const responseUsageSchema = z.looseObject({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

const responseErrorSchema = z.looseObject({
  message: z.string().optional(),
  code: z.string().nullish(),
  type: z.string().nullish(),
});

const responsesApiPayloadSchema = z.looseObject({
  id: z.string().optional(),
  object: z.string().optional(),
  status: z.string().optional(),
  model: z.string().optional(),
  output_text: z.string().nullish(),
  output: z.array(responseOutputItemSchema).optional(),
  usage: responseUsageSchema.nullish(),
  error: responseErrorSchema.nullish(),
});

export type ResponsesApiPayload = z.infer<typeof responsesApiPayloadSchema>;

export type AiResponseResult = {
  id: string | null;
  model: string;
  status: string | null;
  outputText: string;
  annotations: AiResponseAnnotation[];
  usage: AiResponseUsage | null;
  raw: ResponsesApiPayload;
};

export class AiResponseError extends Error {
  readonly status: number | null;
  readonly code: string;

  constructor(message: string, options: { status?: number | null; code?: string } = {}) {
    super(message);
    this.name = "AiResponseError";
    this.status = options.status ?? null;
    this.code = options.code ?? "AI_RESPONSE_FAILED";
  }
}

export function extractResponseText(payload: Pick<ResponsesApiPayload, "output" | "output_text">) {
  const parts: string[] = [];
  for (const item of payload.output ?? []) {
    if (item.type !== "message" || !item.content) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && typeof part.text === "string" && part.text.length > 0) {
        parts.push(part.text);
      }
    }
  }
  if (parts.length > 0) return parts.join("");
  return typeof payload.output_text === "string" ? payload.output_text : "";
}

export function extractResponseAnnotations(payload: Pick<ResponsesApiPayload, "output">): AiResponseAnnotation[] {
  const annotations: AiResponseAnnotation[] = [];
  for (const item of payload.output ?? []) {
    if (item.type !== "message" || !item.content) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && part.annotations?.length) {
        annotations.push(...part.annotations);
      }
    }
  }
  return annotations;
}

export async function createAiResponse(
  request: CreateAiResponseInput,
  options: { env?: Record<string, string | undefined>; config?: AiEnvironment; fetchImpl?: typeof fetch } = {},
): Promise<AiResponseResult> {
  const config = options.config ?? getAiEnvironment(options.env);
  const model = trimToUndefined(request.model) ?? config.defaultModel;
  if (!model) {
    throw new AiResponseError("AI model is not specified.", { code: "AI_MODEL_MISSING" });
  }
  if (typeof request.input === "string" ? !request.input.trim() : request.input.length === 0) {
    throw new AiResponseError("AI response input cannot be empty.", { code: "AI_INPUT_EMPTY" });
  }

  const timeoutMs = Math.min(Math.max(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, 100), MAX_TIMEOUT_MS);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;

  const body: Record<string, unknown> = {
    model,
    input: request.input,
  };
  if (request.instructions !== undefined) body.instructions = request.instructions;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxOutputTokens !== undefined) body.max_output_tokens = request.maxOutputTokens;
  if (request.tools !== undefined) body.tools = request.tools;
  if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
  if (request.text !== undefined) body.text = request.text;
  if (request.reasoning !== undefined) body.reasoning = request.reasoning;
  if (request.store !== undefined) body.store = request.store;
  if (request.metadata !== undefined) body.metadata = request.metadata;

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(buildResponsesUrl(config.baseUrl), {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw new AiResponseError(
      error instanceof Error && error.name === "TimeoutError"
        ? "AI Responses API request timed out."
        : "AI Responses API request failed.",
      { code: error instanceof Error && error.name === "TimeoutError" ? "AI_TIMEOUT" : "AI_NETWORK_ERROR" },
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AiResponseError(`AI Responses API returned non-JSON response (${response.status}).`, {
      status: response.status,
      code: "AI_INVALID_RESPONSE",
    });
  }

  const parsed = responsesApiPayloadSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiResponseError(`AI Responses API returned an unexpected payload (${response.status}).`, {
      status: response.status,
      code: "AI_INVALID_RESPONSE",
    });
  }

  if (!response.ok || parsed.data.error) {
    throw new AiResponseError(
      parsed.data.error?.message ?? `AI Responses API rejected request (${response.status}).`,
      {
        status: response.status,
        code: parsed.data.error?.code ?? "AI_UPSTREAM_ERROR",
      },
    );
  }

  const payload = parsed.data;
  return {
    id: payload.id ?? null,
    model: payload.model ?? model,
    status: payload.status ?? null,
    outputText: extractResponseText(payload),
    annotations: extractResponseAnnotations(payload),
    usage: payload.usage
      ? {
          inputTokens: payload.usage.input_tokens,
          outputTokens: payload.usage.output_tokens,
          totalTokens: payload.usage.total_tokens,
        }
      : null,
    raw: payload,
  };
}
