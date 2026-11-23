export const entitlementKinds = ["trial", "quote"] as const;
export const usageKinds = ["monitoring", "content", "labor"] as const;
export const entitlementQuotaMax = 1_000_000;

export type EntitlementKind = (typeof entitlementKinds)[number];
export type UsageKind = (typeof usageKinds)[number];

export type UsageSlice = {
  kind: UsageKind;
  quantity: number;
};

export type UsageTotals = Record<UsageKind, number>;

// Package changes allocate a new version. Existing usage stays on the previous entitlement id.
export function nextEntitlementVersion(currentMax: number) {
  return currentMax + 1;
}

export function usageTotals(usages: UsageSlice[]): UsageTotals {
  const totals: UsageTotals = { monitoring: 0, content: 0, labor: 0 };
  for (const usage of usages) totals[usage.kind] += usage.quantity;
  return totals;
}

export function usageStaysOnEntitlement(usageEntitlementId: string, revisedEntitlementId: string) {
  return usageEntitlementId !== revisedEntitlementId;
}

// Stored integers stay digit-for-digit across interface languages.
export function plainInteger(value: number) {
  return String(value);
}
