import "server-only";

import { formalRunEligibility } from "../capabilities/rules.ts";
import { requestOfficialSample } from "../../lib/ai/official-sampling-http.ts";
import {
  officialSamplingConfigSchema,
  parseOfficialSamplingConfig,
  type OfficialSamplingConfig,
} from "../../lib/ai/official-sampling.ts";
import {
  closedOfficialPort,
  type OfficialChannelGate,
  type OfficialProbe,
  type OfficialSamplingPort,
  type SamplingRequest,
} from "./transport.ts";

const capabilityStatuses = ["candidate", "verified", "degraded", "disabled"] as const;

function gateFromRequest(input: SamplingRequest): OfficialChannelGate | null {
  const capability = input.capability;
  if (!capability) return null;
  return {
    channelId: capability.channelId,
    kind: capability.kind,
    status: capability.status,
    productEntry: capability.productEntry,
    modelVersion: capability.modelVersion,
    verifiedAt: capability.verifiedAt,
    expiresAt: capability.expiresAt,
  };
}

function probeChannel(config: OfficialSamplingConfig, channel: OfficialChannelGate, now: string): OfficialProbe {
  if (channel.kind !== "model_api" || channel.productEntry !== config.productEntry) {
    return { open: false, code: "REAL_CHANNEL_CLOSED" };
  }
  if (!channel.modelVersion.trim() || channel.modelVersion === "unknown") {
    return { open: false, code: "REAL_CHANNEL_CLOSED" };
  }
  const status = capabilityStatuses.find((item) => item === channel.status);
  if (!status || formalRunEligibility({
    status, verifiedAt: channel.verifiedAt, expiresAt: channel.expiresAt,
  }, now) !== "eligible") {
    return { open: false, code: "CHANNEL_UNVERIFIED" };
  }
  return { open: true };
}

export function createOfficialSamplingPort(
  config: OfficialSamplingConfig,
  options: { fetchImpl?: typeof fetch } = {},
): OfficialSamplingPort {
  const parsed = officialSamplingConfigSchema.safeParse(config);
  if (!parsed.success) return closedOfficialPort();
  const ready = { ...parsed.data, baseUrl: parsed.data.baseUrl.replace(/\/+$/, "") };
  return {
    label: "official_api",
    probe(channel, now) {
      return probeChannel(ready, channel, now);
    },
    priced(model, currency) {
      return Boolean(currency && currency === ready.priceTable.currency && ready.priceTable.models[model]);
    },
    sample(input) {
      const channel = gateFromRequest(input);
      if (!channel || !input.now) return Promise.reject(new Error("REAL_CHANNEL_CLOSED"));
      const decision = probeChannel(ready, channel, input.now);
      if (!decision.open) return Promise.reject(new Error(decision.code));
      const capability = input.capability;
      if (!capability) return Promise.reject(new Error("REAL_CHANNEL_CLOSED"));
      return requestOfficialSample(ready, {
        questionText: input.questionText ?? "",
        requestedNetworkMode: input.requestedNetworkMode ?? "unknown",
        model: capability.modelVersion,
        citationCapability: capability.citationCapability,
        currency: input.currency ?? null,
        upperMinor: input.upperMinor ?? null,
      }, options.fetchImpl);
    },
  };
}

export function officialSamplingPortFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: { fetchImpl?: typeof fetch } = {},
): OfficialSamplingPort {
  const parsed = parseOfficialSamplingConfig(env);
  if (!parsed.success) return closedOfficialPort();
  return createOfficialSamplingPort(parsed.data, options);
}
