import { z } from "zod";

export const officialNetworkTriggers = ["triggered", "not_triggered", "unknown"] as const;
export const officialCitationStates = ["complete", "partial", "missing", "unsupported"] as const;
export type OfficialNetworkTrigger = (typeof officialNetworkTriggers)[number];
export type OfficialCitationState = (typeof officialCitationStates)[number];

export type OfficialCitation = {
  url: string;
  title: string | null;
  position: number;
};

type OfficialSampleBase = {
  synthetic: false;
  responseId: string | null;
  modelVersion: string | null;
  networkTrigger: OfficialNetworkTrigger;
  citations: OfficialCitation[];
  searchResults: OfficialCitation[];
  citationSetState: OfficialCitationState;
};

export type OfficialSample =
  | (OfficialSampleBase & {
    disposition: "adopted";
    rawText: string;
    actualMinor: number;
    currency: string;
    costState: "known";
    reconciliationRequired: false;
  })
  | (OfficialSampleBase & {
    disposition: "safe_failure";
    rawText: null;
    actualMinor: null;
    costState: "known";
    reconciliationRequired: false;
  })
  | (OfficialSampleBase & {
    disposition: "unknown";
    rawText: string | null;
    actualMinor: null;
    costState: "unknown";
    reconciliationRequired: true;
  });

export type OfficialPriceRate = {
  inputMinorPerMillion: number;
  outputMinorPerMillion: number;
};

export type OfficialPriceTable = {
  currency: string;
  models: Record<string, OfficialPriceRate>;
};

export type OfficialSamplingConfig = {
  baseUrl: string;
  apiKey: string;
  productEntry: string;
  priceTable: OfficialPriceTable;
  timeoutMs?: number;
};

const MILLION = 1_000_000;
const MAX_TEXT = 8000;

function isHttpUrl(value: string) {
  const parsed = URL.parse(value);
  return Boolean(
    parsed &&
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash,
  );
}

const rateSchema = z.strictObject({
  inputMinorPerMillion: z.number().int().nonnegative(),
  outputMinorPerMillion: z.number().int().nonnegative(),
});

export const officialPriceTableSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  models: z.record(z.string().trim().min(1).max(80), rateSchema),
});

export const officialSamplingConfigSchema = z.strictObject({
  baseUrl: z.string().trim().min(1).max(300).refine(isHttpUrl),
  apiKey: z.string().trim().min(1).max(500),
  productEntry: z.string().trim().min(1).max(200),
  priceTable: officialPriceTableSchema,
  timeoutMs: z.number().int().min(50).max(120_000).optional(),
});

const citationItemSchema = z.looseObject({
  url: z.string().optional(),
  title: z.string().max(200).optional(),
});

const geoSamplingSchema = z.looseObject({
  network_trigger: z.enum(officialNetworkTriggers).optional(),
  citation_support: z.enum(officialCitationStates).optional(),
  citations: z.array(citationItemSchema).max(50).optional(),
  search_results: z.array(citationItemSchema).max(50).optional(),
});

const outputPartSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  annotations: z.array(z.looseObject({ type: z.string().optional(), url: z.string().optional(), title: z.string().optional() })).optional(),
});

const outputItemSchema = z.looseObject({
  type: z.string(),
  status: z.string().optional(),
  content: z.array(outputPartSchema).optional(),
  action: z.looseObject({
    type: z.string().optional(),
    sources: z.array(z.looseObject({
      type: z.string().optional(),
      url: z.string().optional(),
      title: z.string().optional(),
    })).max(50).optional(),
  }).optional(),
});

const officialPayloadSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string().optional(),
  model: z.string().optional(),
  output_text: z.string().nullish(),
  output: z.array(outputItemSchema).optional(),
  usage: z.looseObject({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }).nullish(),
  error: z.looseObject({ message: z.string().optional() }).nullish(),
  geo_sampling: geoSamplingSchema.optional(),
});

export type OfficialPayload = z.infer<typeof officialPayloadSchema>;

function trimToUndefined(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseOfficialSamplingConfig(env: Record<string, string | undefined>) {
  const priceText = trimToUndefined(env.GEO_OFFICIAL_SAMPLING_PRICE_TABLE);
  let priceTable: unknown;
  if (priceText) {
    try {
      priceTable = JSON.parse(priceText);
    } catch {
      priceTable = null;
    }
  }
  const timeoutText = trimToUndefined(env.GEO_OFFICIAL_SAMPLING_TIMEOUT_MS);
  return officialSamplingConfigSchema.safeParse({
    baseUrl: trimToUndefined(env.GEO_OFFICIAL_SAMPLING_BASE_URL),
    apiKey: trimToUndefined(env.GEO_OFFICIAL_SAMPLING_API_KEY),
    productEntry: trimToUndefined(env.GEO_OFFICIAL_SAMPLING_PRODUCT_ENTRY),
    priceTable,
    timeoutMs: timeoutText ? Number(timeoutText) : undefined,
  });
}

export function officialResponsesUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/responses`;
}

export function unknownOfficialSample(rawText: string | null = null, modelVersion: string | null = null): OfficialSample {
  return {
    disposition: "unknown",
    synthetic: false,
    responseId: null,
    rawText: rawText && rawText.length <= MAX_TEXT ? rawText : null,
    modelVersion,
    networkTrigger: "unknown",
    citations: [],
    searchResults: [],
    citationSetState: "missing",
    actualMinor: null,
    costState: "unknown",
    reconciliationRequired: true,
  };
}

export function safeFailureOfficialSample(): OfficialSample {
  return {
    disposition: "safe_failure",
    synthetic: false,
    responseId: null,
    rawText: null,
    modelVersion: null,
    networkTrigger: "unknown",
    citations: [],
    searchResults: [],
    citationSetState: "missing",
    actualMinor: null,
    costState: "known",
    reconciliationRequired: false,
  };
}

export function officialNetworkFacts(trigger: OfficialNetworkTrigger, searchRequired: 0 | 1) {
  if (trigger === "triggered") {
    return {
      actualNetwork: "true" as const,
      triggerEvidence: "observed" as const,
      qualifiesRequiredSearch: searchRequired === 1 ? 1 as const : 0 as const,
    };
  }
  if (trigger === "not_triggered") {
    return { actualNetwork: "false" as const, triggerEvidence: "none" as const, qualifiesRequiredSearch: 0 as const };
  }
  return { actualNetwork: "unknown" as const, triggerEvidence: "none" as const, qualifiesRequiredSearch: 0 as const };
}

function citationUrl(value: string | undefined) {
  if (!value || value.length > 2000 || !isHttpUrl(value)) return null;
  const normalized = new URL(value).toString();
  return normalized.length <= 2000 ? normalized : null;
}

function citationsFrom(items: Array<{ url?: string; title?: string }> | undefined) {
  const citations: OfficialCitation[] = [];
  let invalid = 0;
  for (const item of items ?? []) {
    const url = citationUrl(item.url);
    if (!url) {
      invalid += 1;
      continue;
    }
    citations.push({
      url,
      title: item.title?.trim() ? item.title.trim().slice(0, 200) : null,
      position: citations.length + 1,
    });
  }
  return { citations, invalid, length: items?.length ?? 0 };
}

function annotationCitations(payload: OfficialPayload) {
  const items: Array<{ url?: string; title?: string }> = [];
  let sawField = false;
  for (const output of payload.output ?? []) {
    for (const part of output.content ?? []) {
      if (part.annotations) {
        sawField = true;
        for (const annotation of part.annotations) {
          if (annotation.type === "url_citation") items.push({ url: annotation.url, title: annotation.title });
        }
      }
    }
  }
  return { sawField, ...citationsFrom(items) };
}

function classifyList(
  support: OfficialCitationState | undefined,
  parsed: { citations: OfficialCitation[]; invalid: number; length: number },
  sawPayload: boolean,
  capability: "complete" | "partial" | "unsupported",
) {
  if (support === "unsupported") return { citationSetState: "unsupported" as const, citations: parsed.citations };
  if (support === "missing") return { citationSetState: "missing" as const, citations: [] as OfficialCitation[] };
  if (!sawPayload && support === undefined) {
    return {
      citationSetState: capability === "unsupported" ? "unsupported" as const : "missing" as const,
      citations: [] as OfficialCitation[],
    };
  }
  if (support === "partial") {
    return {
      citationSetState: parsed.citations.length > 0 ? "partial" as const : "missing" as const,
      citations: parsed.citations,
    };
  }
  if (parsed.length === 0) return { citationSetState: "complete" as const, citations: [] as OfficialCitation[] };
  if (parsed.invalid === 0) return { citationSetState: "complete" as const, citations: parsed.citations };
  if (parsed.citations.length === 0) return { citationSetState: "missing" as const, citations: [] as OfficialCitation[] };
  return { citationSetState: "partial" as const, citations: parsed.citations };
}

function classifyCitations(payload: OfficialPayload, capability: "complete" | "partial" | "unsupported") {
  const support = payload.geo_sampling?.citation_support;
  const explicit = payload.geo_sampling !== undefined && Object.hasOwn(payload.geo_sampling, "citations");
  if (explicit) return classifyList(support, citationsFrom(payload.geo_sampling?.citations), true, capability);
  const annotations = annotationCitations(payload);
  return classifyList(support, annotations, annotations.sawField, capability);
}

/** Explicit search lists stay out of the native citation completeness decision. */
function explicitSearchResults(payload: OfficialPayload): OfficialCitation[] {
  const geo = payload.geo_sampling;
  if (geo && Object.hasOwn(geo, "search_results")) return citationsFrom(geo.search_results).citations;
  const items: Array<{ url?: string; title?: string }> = [];
  for (const output of payload.output ?? []) {
    if (output.type !== "web_search_call" || output.action?.type !== "search" || !output.action.sources) continue;
    for (const source of output.action.sources) items.push({ url: source.url, title: source.title });
  }
  return citationsFrom(items).citations;
}

function responseText(payload: OfficialPayload) {
  const parts: string[] = [];
  for (const item of payload.output ?? []) {
    if (item.type !== "message" || !item.content) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && part.text) parts.push(part.text);
    }
  }
  if (parts.length > 0) return parts.join("");
  return typeof payload.output_text === "string" ? payload.output_text : "";
}

function networkTrigger(payload: OfficialPayload, requested: "on" | "off" | "unknown"): OfficialNetworkTrigger {
  const explicit = payload.geo_sampling?.network_trigger;
  if (explicit) return explicit;
  const calls = (payload.output ?? []).filter((item) => item.type === "web_search_call");
  if (calls.some((item) => item.status === "completed" || item.status === "in_progress")) return "triggered";
  if (calls.length > 0) return "unknown";
  return requested === "off" ? "not_triggered" : "unknown";
}

export function priceMinor(usage: { input_tokens: number; output_tokens: number } | null | undefined, model: string, table: OfficialPriceTable) {
  const rate = Object.hasOwn(table.models, model) ? table.models[model] : undefined;
  if (!usage || !rate) return null;
  const numerator = usage.input_tokens * rate.inputMinorPerMillion + usage.output_tokens * rate.outputMinorPerMillion;
  if (!Number.isSafeInteger(numerator) || numerator < 0) return null;
  return Math.ceil(numerator / MILLION);
}

export function interpretOfficialPayload(input: {
  httpStatus: number;
  payload: unknown;
  requestedModel: string;
  requestedNetworkMode: "on" | "off" | "unknown";
  citationCapability: "complete" | "partial" | "unsupported";
  priceTable: OfficialPriceTable;
  currency: string | null;
  upperMinor: number | null;
}): OfficialSample {
  const parsed = officialPayloadSchema.safeParse(input.payload);
  const successful = input.httpStatus >= 200 && input.httpStatus < 300;
  const rejected = [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(input.httpStatus);
  if (rejected && !payloadAccepted(input.payload)) return safeFailureOfficialSample();
  if (!parsed.success) return unknownOfficialSample();
  const payload = parsed.data;
  const text = responseText(payload);
  const responseId = responseLocator(payload.id);
  const modelVersion = payload.model?.trim() || input.requestedModel;
  const priced = payload.model === undefined || payload.model === input.requestedModel ? input.requestedModel : null;
  const amount = priced ? priceMinor(payload.usage, priced, input.priceTable) : null;
  const currencyMatches = Boolean(input.currency) && input.priceTable.currency === input.currency;
  const withinCeiling = amount !== null && (input.upperMinor === null || amount <= input.upperMinor);
  const citations = classifyCitations(payload, input.citationCapability);
  const searchResults = explicitSearchResults(payload);
  const trigger = networkTrigger(payload, input.requestedNetworkMode);
  if (successful && (!payload.status || payload.status === "completed")
    && text.length >= 2 && text.length <= MAX_TEXT && !text.includes("\0")
    && amount !== null && currencyMatches && withinCeiling && !payload.error) {
    return {
      disposition: "adopted",
      synthetic: false,
      responseId,
      rawText: text,
      actualMinor: amount,
      currency: input.priceTable.currency,
      costState: "known",
      reconciliationRequired: false,
      modelVersion,
      networkTrigger: trigger,
      ...citations,
      searchResults,
    };
  }
  return {
    ...unknownOfficialSample(text, modelVersion),
    responseId,
    networkTrigger: trigger,
    ...citations,
    searchResults,
  };
}

export const officialReceiptSchema = z.strictObject({
  responseId: z.string().min(1).max(200).nullable(),
  modelVersion: z.string().min(1).max(80).nullable(),
  networkTrigger: z.enum(officialNetworkTriggers),
  citationSetState: z.enum(officialCitationStates),
  citations: z.array(z.strictObject({
    url: z.string().min(1).max(2000),
    title: z.string().min(1).max(200).nullable(),
    position: z.int().positive().max(50),
  })).max(40),
  searchResults: z.array(z.strictObject({
    url: z.string().min(1).max(2000),
    title: z.string().min(1).max(200).nullable(),
    position: z.int().positive().max(50),
  })).max(40).optional(),
});

export function parseOfficialReceipt(value: string | null) {
  if (!value) return null;
  try {
    const parsed = officialReceiptSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeOfficialReceipt(sample: Pick<OfficialSample, "responseId" | "modelVersion" | "networkTrigger" | "citationSetState" | "citations"> & { searchResults?: OfficialCitation[] }) {
  const citations: OfficialCitation[] = [];
  const body: {
    responseId: string | null;
    modelVersion: string | null;
    networkTrigger: OfficialNetworkTrigger;
    citationSetState: OfficialCitationState;
    citations: OfficialCitation[];
    searchResults?: OfficialCitation[];
  } = {
    responseId: responseLocator(sample.responseId ?? undefined),
    modelVersion: sample.modelVersion && sample.modelVersion.length <= 80 ? sample.modelVersion : null,
    networkTrigger: sample.networkTrigger,
    citationSetState: sample.citationSetState,
    citations,
  };
  // Keep the URLs intact and mark any loss of completeness when hitting the storage limit.
  for (const item of sample.citations) {
    if (citations.length === 40) break;
    const url = citationUrl(item.url);
    if (!url) continue;
    citations.push({ url, title: item.title?.trim().slice(0, 200) || null, position: citations.length + 1 });
    if (JSON.stringify(body).length > 8000) {
      citations.pop();
      break;
    }
  }
  if (citations.length !== sample.citations.length && body.citationSetState === "complete") {
    body.citationSetState = citations.length ? "partial" : "missing";
  }
  const searchResults: OfficialCitation[] = [];
  for (const item of sample.searchResults ?? []) {
    if (searchResults.length === 40) break;
    const url = citationUrl(item.url);
    if (!url) continue;
    searchResults.push({ url, title: item.title?.trim().slice(0, 200) || null, position: searchResults.length + 1 });
    body.searchResults = searchResults;
    if (JSON.stringify(body).length > 8000) {
      searchResults.pop();
      break;
    }
  }
  if (searchResults.length === 0) delete body.searchResults;
  return JSON.stringify(body);
}

function responseLocator(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 200 || !/^[\w.:-]+$/.test(trimmed)) return null;
  return trimmed;
}

function payloadAccepted(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  return ("id" in payload && typeof payload.id === "string" && payload.id.length > 0)
    || ("usage" in payload && payload.usage != null)
    || ("output" in payload && Array.isArray(payload.output) && payload.output.length > 0)
    || ("output_text" in payload && typeof payload.output_text === "string" && payload.output_text.length > 0);
}
