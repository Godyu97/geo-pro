import type { OfficialSample } from "../../lib/ai/official-sampling.ts";

export type { OfficialCitation, OfficialCitationState, OfficialNetworkTrigger, OfficialSample } from "../../lib/ai/official-sampling.ts";

export type SamplingRequest = {
  slotId: string;
  questionId: string;
  channelId: string;
  ordinal: number;
  questionText?: string;
  requestedNetworkMode?: "on" | "off" | "unknown";
  upperMinor?: number | null;
  currency?: string | null;
  now?: string;
  capability?: {
    channelId: string;
    version: number;
    kind: string;
    status: string;
    productEntry: string;
    modelVersion: string;
    citationCapability: "complete" | "partial" | "unsupported";
    searchRequired: 0 | 1;
    verifiedAt: string | null;
    expiresAt: string | null;
  };
};

export type IsolatedSample =
  | { disposition: "adopted"; rawText: string; actualMinor: number; synthetic: true }
  | { disposition: "safe_failure"; synthetic: true }
  | { disposition: "unknown"; rawText?: string | null; synthetic: true };

export type OfficialChannelGate = {
  channelId: string;
  kind: string;
  status: string;
  productEntry: string;
  modelVersion: string;
  verifiedAt: string | null;
  expiresAt: string | null;
};

export type OfficialProbe =
  | { open: true }
  | { open: false; code: "REAL_CHANNEL_CLOSED" | "CHANNEL_UNVERIFIED" };

// A real official adapter is supplied by createOfficialSamplingPort. This port stays closed.
export type OfficialSamplingPort = {
  label: "official_api";
  probe(channel: OfficialChannelGate, now: string): OfficialProbe;
  priced(model: string, currency: string | null): boolean;
  sample(input: SamplingRequest): Promise<OfficialSample>;
};

export function closedOfficialPort(): OfficialSamplingPort {
  return {
    label: "official_api",
    probe() {
      return { open: false, code: "REAL_CHANNEL_CLOSED" };
    },
    priced() {
      return false;
    },
    sample() {
      return Promise.reject(new Error("REAL_CHANNEL_CLOSED"));
    },
  };
}
