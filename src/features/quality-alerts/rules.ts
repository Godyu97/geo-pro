export type AlertKind = "data_quality" | "trend";
export type AlertStatus = "open" | "acknowledged" | "resolved" | "snoozed";
export type AlertReason = "coverage_insufficient" | "citation_field_changed" | "mode_changed" | "recommendation_drop";

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

export type WindowSample = {
  windowId: string;
  completed: boolean;
  coverageSufficient: boolean;
  citationFieldChanged: boolean;
  modeChanged: boolean;
  recommendationRate: number | null;
};

/** The latest window decides a quality reason. A trend never uses that quality reason. */
export function monitoringAlertReason(kind: AlertKind, latest: WindowSample): AlertReason | null {
  if (kind === "trend") return "recommendation_drop";
  if (!latest.coverageSufficient) return "coverage_insufficient";
  if (latest.citationFieldChanged) return "citation_field_changed";
  if (latest.modeChanged) return "mode_changed";
  return null;
}

/** Quality problems suppress a brand-decline claim. A trend needs two completed comparable windows. */
export function assessMonitoringAlert(windows: readonly WindowSample[], thresholdPp = defaultThresholdPp) {
  const latest = windows[windows.length - 1];
  if (!latest) return { kind: "none" as const, claimBrandDecline: false };
  if (!latest.coverageSufficient || latest.citationFieldChanged || latest.modeChanged) {
    return { kind: "data_quality" as const, claimBrandDecline: false };
  }
  const comparable = windows.filter((window) => (
    window.completed && window.coverageSufficient && window.recommendationRate !== null
  ));
  const previous = comparable[comparable.length - 2];
  const current = comparable[comparable.length - 1];
  if (!previous || !current || previous.recommendationRate === null || current.recommendationRate === null) {
    return { kind: "none" as const, claimBrandDecline: false };
  }
  const dropPp = (previous.recommendationRate - current.recommendationRate) * 100;
  if (dropPp > thresholdPp) return { kind: "trend" as const, claimBrandDecline: true };
  return { kind: "none" as const, claimBrandDecline: false };
}

export type StoredAlert = {
  brandId: string;
  kind: AlertKind;
  windowId: string;
  status: AlertStatus;
  occurrences: readonly string[];
};

const alertTransitions: Record<AlertStatus, readonly AlertStatus[]> = {
  open: ["acknowledged", "resolved", "snoozed"],
  acknowledged: ["resolved", "snoozed"],
  snoozed: ["open", "resolved"],
  resolved: ["open"],
};

export function recordAlertOccurrence(alert: StoredAlert, next: AlertStatus, occurrenceId: string) {
  if (next !== alert.status && !alertTransitions[alert.status].includes(next)) return null;
  return { ...alert, status: next, occurrences: [...alert.occurrences, occurrenceId] };
}
