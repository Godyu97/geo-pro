import "server-only";

import {
  interpretOfficialPayload,
  officialResponsesUrl,
  safeFailureOfficialSample,
  unknownOfficialSample,
  type OfficialSample,
  type OfficialSamplingConfig,
} from "./official-sampling.ts";

const MAX_BODY = 1_000_000;

export type OfficialHttpRequest = {
  questionText: string;
  requestedNetworkMode: "on" | "off" | "unknown";
  model: string;
  citationCapability: "complete" | "partial" | "unsupported";
  currency: string | null;
  upperMinor: number | null;
};

export async function requestOfficialSample(
  config: OfficialSamplingConfig,
  request: OfficialHttpRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<OfficialSample> {
  const question = request.questionText.trim();
  if (!question || question.length > 4000) return unknownOfficialSample();
  if (!request.currency || request.currency !== config.priceTable.currency
    || !Object.hasOwn(config.priceTable.models, request.model) || request.upperMinor === null || request.upperMinor <= 0) {
    return safeFailureOfficialSample();
  }
  const timeoutMs = config.timeoutMs ?? 30_000;
  const body: Record<string, unknown> = {
    model: request.model,
    input: question,
    store: false,
  };
  if (request.requestedNetworkMode === "on") body.tools = [{ type: "web_search" }];

  // Each durable attempt authorizes one POST. A broken connection can occur
  // after acceptance, so only the response classifier can allow another try.
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
    try {
      payload = JSON.parse(text);
    } catch {
      // The status still distinguishes explicit rejection from unknown acceptance.
    }
    return interpretOfficialPayload({
      httpStatus: response.status,
      payload,
      requestedModel: request.model,
      requestedNetworkMode: request.requestedNetworkMode,
      citationCapability: request.citationCapability,
      priceTable: config.priceTable,
      currency: request.currency,
      upperMinor: request.upperMinor,
    });
  } catch {
    return unknownOfficialSample();
  }
}
