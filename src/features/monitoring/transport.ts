export type SamplingRequest = {
  slotId: string;
  questionId: string;
  channelId: string;
  ordinal: number;
};

export type IsolatedSample =
  | { disposition: "adopted"; rawText: string; actualMinor: number; synthetic: true }
  | { disposition: "safe_failure"; synthetic: true }
  | { disposition: "unknown"; rawText?: string | null; synthetic: true };

// #31 supplies a real official adapter. Until then this port fails closed and does not invent a result.
export type OfficialSamplingPort = {
  label: "official_api";
  sample(input: SamplingRequest): Promise<IsolatedSample>;
};

export function closedOfficialPort(): OfficialSamplingPort {
  return {
    label: "official_api",
    sample() {
      return Promise.reject(new Error("REAL_CHANNEL_CLOSED"));
    },
  };
}
