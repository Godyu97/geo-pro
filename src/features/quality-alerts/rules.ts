export type AlertKind = "data_quality" | "trend";
export type AlertStatus = "open" | "acknowledged" | "resolved" | "snoozed";

export type AlertDraft = {
  brandId: string;
  kind: AlertKind;
  windowId: string;
  coverageSufficient: boolean;
  dropPp: number;
};

const defaultThresholdPp = 10;

export function planAlerts(input: AlertDraft, thresholdPp = defaultThresholdPp): AlertKind[] {
  const kinds: AlertKind[] = [];
  if (!input.coverageSufficient) kinds.push("data_quality");
  if (input.coverageSufficient && input.dropPp > thresholdPp) kinds.push("trend");
  return kinds;
}

export function mergeAlerts<T extends { brandId: string; kind: AlertKind; windowId: string }>(existing: readonly T[], incoming: T) {
  const prior = existing.find((item) => item.brandId === incoming.brandId && item.kind === incoming.kind && item.windowId === incoming.windowId);
  return prior ? { created: false as const, alert: prior } : { created: true as const, alert: incoming };
}
