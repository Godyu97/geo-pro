import type { AlertKind, WindowSample } from "../quality-alerts/rules.ts";
import { assessMonitoringAlert } from "../quality-alerts/rules.ts";
import type { SamplingSlotStatus } from "./rules.ts";

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
export const dueCoverageFloor = 0.9;

export type ChannelGateState = "eligible" | "degraded" | "expired";

export type DueSlotView = {
  id: string;
  channelId: string;
  at: string;
  status: SamplingSlotStatus;
  manual: boolean;
  costMinor: number;
};

export type DueIdentity = {
  slotId: string;
  channelId: string;
  windowId: string;
  status: "reserved" | "accepted" | "sheet";
};

export function isTimeZone(timeZone: string) {
  if (timeZone.length < 1 || timeZone.length > 64) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function localWindowId(instant: string, timeZone: string) {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms) || !isTimeZone(timeZone)) return null;
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
  return datePattern.test(formatted) ? formatted : null;
}

function wallClockMs(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const hour = value("hour");
  const base = Date.UTC(value("year"), value("month") - 1, value("day"), hour === 24 ? 0 : hour, value("minute"), value("second"));
  return hour === 24 ? base + 86_400_000 : base;
}

function zonedMidnight(windowId: string, timeZone: string) {
  const target = Date.parse(`${windowId}T00:00:00.000Z`);
  let utc = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const delta = target - wallClockMs(utc, timeZone);
    utc += delta;
    if (delta === 0) break;
  }
  return utc;
}

export function windowBounds(windowId: string, timeZone: string) {
  if (!datePattern.test(windowId) || !isTimeZone(timeZone)) return null;
  const [year, month, day] = windowId.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1));
  const nextId = next.toISOString().slice(0, 10);
  const start = zonedMidnight(windowId, timeZone);
  const end = zonedMidnight(nextId, timeZone);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

function identityKey(channelId: string, windowId: string, slotId: string) {
  return `${channelId}\u0000${windowId}\u0000${slotId}`;
}

export type DueDecision = {
  pauses: Array<{ id: string; reason: "budget" | "channel" }>;
  official: Array<{ slotId: string; channelId: string; windowId: string; costMinor: number }>;
  manuals: Array<{ slotId: string; channelId: string; windowId: string; promptIds: readonly string[] }>;
  replays: string[];
  pending: string[];
  invalid: "timezone" | "prompts" | null;
};

/** Classify one clock reading. Budget pauses only the official track; a bad channel pauses only itself. */
export function decideDueWindow(input: {
  now: string;
  timeZone: string;
  remainingMinor: number;
  slots: readonly DueSlotView[];
  channels: readonly { channelId: string; state: ChannelGateState }[];
  existing: readonly DueIdentity[];
  promptIds: readonly string[];
  allowOfficialStart: boolean;
}): DueDecision {
  if (!isTimeZone(input.timeZone) || !Number.isFinite(Date.parse(input.now))) {
    return { pauses: [], official: [], manuals: [], replays: [], pending: [], invalid: "timezone" };
  }
  const gates = new Map(input.channels.map((channel) => [channel.channelId, channel.state]));
  const known = new Map(input.existing.map((row) => [identityKey(row.channelId, row.windowId, row.slotId), row]));
  const gateOf = (channelId: string): ChannelGateState => {
    if (input.channels.length === 0) return "eligible";
    return gates.get(channelId) ?? "degraded";
  };

  const pauses: DueDecision["pauses"] = [];
  const paused = new Set<string>();
  for (const slot of input.slots) {
    if (slot.status !== "scheduled" || slot.at < input.now) continue;
    if (gateOf(slot.channelId) === "eligible") continue;
    paused.add(slot.id);
    pauses.push({ id: slot.id, reason: "channel" });
  }

  const nextOfficial = input.slots
    .filter((slot) => !slot.manual && slot.status === "scheduled" && slot.at >= input.now && !paused.has(slot.id))
    .sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id))[0];
  if (nextOfficial && input.remainingMinor < nextOfficial.costMinor) {
    for (const slot of input.slots) {
      if (slot.manual || slot.status !== "scheduled" || slot.at < input.now || paused.has(slot.id)) continue;
      paused.add(slot.id);
      pauses.push({ id: slot.id, reason: "budget" });
    }
  }

  let remaining = input.remainingMinor;
  const official: DueDecision["official"] = [];
  const manuals: DueDecision["manuals"] = [];
  const replays: string[] = [];
  const pending: string[] = [];
  const due = input.slots
    .filter((slot) => slot.status === "scheduled" && slot.at <= input.now && !paused.has(slot.id))
    .sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
  for (const slot of due) {
    const windowId = localWindowId(slot.at, input.timeZone);
    if (!windowId) return { pauses, official, manuals, replays, pending, invalid: "timezone" };
    if (gateOf(slot.channelId) !== "eligible") continue;
    const prior = known.get(identityKey(slot.channelId, windowId, slot.id));
    if (prior) {
      if (prior.status === "reserved") pending.push(slot.id);
      else replays.push(slot.id);
      continue;
    }
    if (slot.manual) {
      if (input.promptIds.length === 0) {
        return { pauses, official, manuals, replays, pending, invalid: "prompts" };
      }
      manuals.push({ slotId: slot.id, channelId: slot.channelId, windowId, promptIds: input.promptIds });
      continue;
    }
    if (!input.allowOfficialStart) {
      pending.push(slot.id);
      continue;
    }
    if (remaining < slot.costMinor) continue;
    remaining -= slot.costMinor;
    official.push({ slotId: slot.id, channelId: slot.channelId, windowId, costMinor: slot.costMinor });
  }
  return { pauses, official, manuals, replays, pending, invalid: null };
}

export type ObservationFact = {
  windowId: string;
  evidenceState: string;
  citationSetState: string;
  requestedNetworkMode: string;
  networkTrigger: string;
  recommended: "true" | "false" | "unknown" | null;
};

export function observationEligible(row: Pick<ObservationFact, "evidenceState" | "citationSetState" | "requestedNetworkMode" | "networkTrigger">) {
  if (row.evidenceState !== "complete") return false;
  if (row.citationSetState !== "complete") return false;
  if (row.requestedNetworkMode === "on" && row.networkTrigger !== "triggered") return false;
  return true;
}

export type WindowReadingDraft = {
  windowId: string;
  plannedCount: number;
  eligibleCount: number;
  recommendedCount: number;
  judgedCount: number;
  coverageSufficient: boolean;
  comparableWindows: number;
  waitingForTrend: boolean;
  closed: boolean;
};

function modesOf(rows: readonly ObservationFact[]) {
  return [...new Set(rows.map((row) => row.requestedNetworkMode))].sort().join(",");
}

/** Closed windows can alert. An open window keeps a reading and does not claim a trend. */
export function buildWindowReadings(input: {
  windows: readonly {
    windowId: string;
    statuses: readonly SamplingSlotStatus[];
    plannedCount: number;
    observations: readonly ObservationFact[];
  }[];
  thresholdPp?: number;
}): { readings: WindowReadingDraft[]; samples: WindowSample[]; alertKind: AlertKind | "none"; claimBrandDecline: boolean } {
  const ordered = [...input.windows].sort((left, right) => left.windowId.localeCompare(right.windowId));
  const readings: WindowReadingDraft[] = [];
  const samples: WindowSample[] = [];
  for (const [index, window] of ordered.entries()) {
    const eligible = window.observations.filter(observationEligible);
    const judged = eligible.filter((row) => row.recommended === "true" || row.recommended === "false");
    const recommended = judged.filter((row) => row.recommended === "true").length;
    const closed = window.statuses.length > 0 && window.statuses.every((status) => status === "completed" || status === "failed" || status === "paused");
    const terminal = window.statuses.length > 0 && window.statuses.every((status) => status === "completed" || status === "failed");
    const coverageSufficient = terminal && window.plannedCount > 0 && eligible.length / window.plannedCount >= dueCoverageFloor;
    const previous = ordered[index - 1];
    const citationFieldChanged = window.observations.some((row) => row.citationSetState !== "complete");
    const modeChanged = Boolean(previous && modesOf(previous.observations) !== modesOf(window.observations) && previous.observations.length > 0 && window.observations.length > 0);
    const recommendationRate = judged.length > 0 ? recommended / judged.length : null;
    readings.push({
      windowId: window.windowId,
      plannedCount: window.plannedCount,
      eligibleCount: eligible.length,
      recommendedCount: recommended,
      judgedCount: judged.length,
      coverageSufficient,
      comparableWindows: 0,
      waitingForTrend: true,
      closed,
    });
    if (closed) {
      samples.push({
        windowId: window.windowId,
        completed: terminal && coverageSufficient,
        coverageSufficient,
        citationFieldChanged: coverageSufficient && citationFieldChanged,
        modeChanged: coverageSufficient && modeChanged,
        recommendationRate,
      });
    }
  }
  const assessment = samples.length > 0 ? assessMonitoringAlert(samples, input.thresholdPp) : { kind: "none" as const, claimBrandDecline: false };
  const comparable = samples.filter((sample) => sample.completed && sample.coverageSufficient && sample.recommendationRate !== null).length;
  for (const reading of readings) {
    reading.comparableWindows = comparable;
    reading.waitingForTrend = comparable < 2;
  }
  return {
    readings,
    samples,
    alertKind: assessment.kind,
    claimBrandDecline: assessment.claimBrandDecline,
  };
}
