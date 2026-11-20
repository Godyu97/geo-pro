import "server-only";

import {
  interpretOfficialPayload,
  officialResponsesUrl,
  payloadAccepted,
  safeFailureOfficialSample,
  unknownOfficialSample,
  type OfficialSample,
  type OfficialSamplingConfig,
} from "./official-sampling.ts";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_BODY = 1_000_000;

export type OfficialHttpRequest = {
  questionText: string;
  requestedNetworkMode: "on" | "off" | "unknown";
  model: string;
  citationCapability: "complete" | "partial" | "unsupported";
  currency: string | null;
  upperMinor: number | null;
};

function timeoutError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return error.cause instanceof Error && (error.cause.name === "TimeoutError" || error.cause.name === "AbortError");
}

function redirectError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return `${error.message} ${cause}`.toLowerCase().includes("redirect");
}

export async function requestOfficialSample(
  config: OfficialSamplingConfig,
  request: OfficialHttpRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<OfficialSample> {
  const question = request.questionText.trim();
  if (!question || question.length > 4000) return unknownOfficialSample();
  const timeoutMs = config.timeoutMs ?? 30_000;
  const body: Record<string, unknown> = {
    model: request.model,
    input: question,
    store: false,
  };
  if (request.requestedNetworkMode === "on") body.tools = [{ type: "web_search" }];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(officialResponsesUrl(config.baseUrl), {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (text.length > MAX_BODY) return unknownOfficialSample();
      let payload: unknown = null;
      if (text.length > 0) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
      const accepted = payloadAccepted(payload);
      if (RETRYABLE.has(response.status) && !accepted && attempt < 2) continue;
      return interpretOfficialPayload({
        httpStatus: response.status,
        payload,
        requestedModel: request.model,
        requestedNetworkMode: request.requestedNetworkMode,
        citationCapability: request.citationCapability,
        priceTable: config.priceTable,
        currency: request.currency,
        upperMinor: request.upperMinor,
        accepted,
      });
    } catch (error) {
      if (timeoutError(error) || redirectError(error)) return unknownOfficialSample();
      if (attempt < 2) continue;
      return safeFailureOfficialSample();
    }
  }
  return safeFailureOfficialSample();
}
