import type { IsolatedSample } from "../monitoring/transport.ts";
import { mockOfficialUnitMinor } from "./channels.ts";
import { functionalMockMarker } from "./mode.ts";

export const mockSamplingCountLimit = 30;
export const mockSamplingBudgetMinor = 3000;

/** Synthetic adopted answer. The caller must keep it on the isolated transport. */
export function mockSampleAnswer(questionId: string): IsolatedSample {
  return {
    disposition: "adopted",
    rawText: `${functionalMockMarker} 合成回答，不是真实供应商原文。问题标识 ${questionId}。`,
    actualMinor: mockOfficialUnitMinor,
    synthetic: true,
  };
}
