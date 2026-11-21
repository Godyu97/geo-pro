import { defaultExpiresAt } from "../capabilities/rules.ts";
import { functionalMockMarker } from "./mode.ts";

export const mockVendorId = "functional-mock";

/** Fixture unit price. It is not a supplier invoice and must not be reported as spend. */
export const mockOfficialUnitMinor = 1;

export function mockChannelDraft(kind: "model_api" | "consumer_ui", now: string) {
  const official = kind === "model_api";
  return {
    vendorId: mockVendorId,
    kind,
    reason: "verification" as const,
    status: "verified" as const,
    displayName: official ? `${functionalMockMarker} 官方 API` : `${functionalMockMarker} 消费者入口`,
    productEntry: official ? "functional-mock://official-api" : "functional-mock://consumer-entry",
    mode: "functional-mock",
    modelVersion: "functional-mock-1",
    availability: "mock-only",
    searchRequired: official ? 1 as const : 0 as const,
    citationCapability: "partial" as const,
    regionTarget: "CN",
    regionActual: "CN",
    limitsSummary: official
      ? `${functionalMockMarker} 合成单价 CNY ${mockOfficialUnitMinor} 分/次。不是供应商账单，也不代表联网监测已通过。`
      : `${functionalMockMarker} 合成消费者入口。没有真实走查，只能承接标明的人工存证。`,
    sopSummary: `${functionalMockMarker} 仅在 GEO_FUNCTIONAL_MOCK=1 时写入。不能当作 #31 的开通证据。`,
    verifiedAt: now,
    expiresAt: defaultExpiresAt(now),
    publicVisible: 0 as const,
  };
}
