import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import type { RecordQualityAlertInput } from "./contracts.ts";
import { QualityAlertDao, type QualityAlertEventRecord, type QualityAlertRecord } from "./dao.ts";
import {
  assessMonitoringAlert,
  mergeAlerts,
  monitoringAlertReason,
  recordAlertOccurrence,
  type AlertStatus,
  type WindowSample,
} from "./rules.ts";

type Clock = () => string;
type Failure = { error: "NOT_FOUND" | "INVALID_INPUT" | "ALERT_STATE_CONFLICT" };

const systemClock: Clock = () => new Date().toISOString();

function uniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /UNIQUE|duplicate key|quality_alert_open_window_uidx/i.test(message);
}

function comparableWindows(windows: readonly WindowSample[]) {
  return windows.filter((window) => window.completed && window.coverageSufficient && window.recommendationRate !== null);
}

export type QualityAlertView = {
  id: string;
  brandId: string;
  kind: QualityAlertRecord["kind"];
  windowId: string;
  status: QualityAlertRecord["status"];
  claimBrandDecline: boolean;
  reason: QualityAlertRecord["reason"];
  createdAt: string;
  updatedAt: string;
  events: Array<{ id: string; occurredAt: string }>;
};

function toView(alert: QualityAlertRecord, events: readonly QualityAlertEventRecord[]): QualityAlertView {
  return {
    id: alert.id,
    brandId: alert.brandId,
    kind: alert.kind,
    windowId: alert.windowId,
    status: alert.status,
    claimBrandDecline: alert.claimBrandDecline === 1,
    reason: alert.reason,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
    events: events.filter((event) => event.alertId === alert.id).map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt,
    })),
  };
}

function eventDraft(alertId: string, brandId: string, ownerId: string, occurredAt: string) {
  return { id: randomUUID(), alertId, brandId, ownerId, occurredAt };
}

async function viewOf(dao: QualityAlertDao, ownerId: string, alert: QualityAlertRecord) {
  const events = await dao.eventsFor(ownerId, [alert.id]);
  return toView(alert, events);
}

export async function listQualityAlerts(db: DatabaseConnection, ownerId: string, brandId: string) {
  const owned = await new BrandDao(db).owned(ownerId, brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const dao = new QualityAlertDao(db);
  const alerts = await dao.alertsForBrand(ownerId, brandId);
  const events = await dao.eventsFor(ownerId, alerts.map((alert) => alert.id));
  return { alerts: alerts.map((alert) => toView(alert, events)) };
}

export async function recordQualityAlert(
  db: DatabaseConnection,
  ownerId: string,
  input: RecordQualityAlertInput,
  clock: Clock = systemClock,
) {
  const assessment = assessMonitoringAlert(input.windows);
  if (assessment.kind === "none") return { recorded: false as const };
  const latest = input.windows[input.windows.length - 1];
  if (!latest) return { recorded: false as const };
  if (assessment.kind === "data_quality" && assessment.claimBrandDecline) {
    return { error: "INVALID_INPUT" as const };
  }
  if (assessment.kind === "trend") {
    if (!assessment.claimBrandDecline || comparableWindows(input.windows).length < 2) {
      return { error: "INVALID_INPUT" as const };
    }
  }
  const reason = monitoringAlertReason(assessment.kind, latest);
  if (!reason) return { error: "INVALID_INPUT" as const };
  const claimBrandDecline = assessment.kind === "data_quality" ? 0 : 1;

  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    return writeAlert(tx, ownerId, input.brandId, latest.windowId, assessment.kind, reason, claimBrandDecline, clock);
  });
}

async function writeAlert(
  tx: TransactionConnection,
  ownerId: string,
  brandId: string,
  windowId: string,
  kind: QualityAlertRecord["kind"],
  reason: QualityAlertRecord["reason"],
  claimBrandDecline: 0 | 1,
  clock: Clock,
): Promise<{ recorded: true; created: boolean; alert: QualityAlertView } | Failure> {
  const dao = new QualityAlertDao(tx);
  const open = await dao.openAlert(ownerId, brandId, kind, windowId);
  const merged = mergeAlerts(
    open ? [{ brandId: open.brandId, kind: open.kind, windowId: open.windowId }] : [],
    { brandId, kind, windowId },
  );
  const now = clock();
  if (!merged.created && open) {
    await dao.insertEvents([eventDraft(open.id, brandId, ownerId, now)]);
    const touched = await dao.touch(ownerId, open.id, now);
    if (!touched) return { error: "NOT_FOUND" };
    return { recorded: true, created: false, alert: await viewOf(dao, ownerId, { ...open, updatedAt: now }) };
  }

  const alert: QualityAlertRecord = {
    id: randomUUID(),
    brandId,
    ownerId,
    kind,
    windowId,
    status: "open",
    claimBrandDecline,
    reason,
    createdAt: now,
    updatedAt: now,
  };
  const event = eventDraft(alert.id, brandId, ownerId, now);
  try {
    await tx.savepoint(async (nested) => {
      const writer = new QualityAlertDao(nested);
      await writer.insertAlerts([alert]);
      await writer.insertEvents([event]);
    });
  } catch (error) {
    if (!uniqueConflict(error)) throw error;
    const current = await dao.openAlert(ownerId, brandId, kind, windowId);
    if (!current) throw error;
    await dao.insertEvents([eventDraft(current.id, brandId, ownerId, now)]);
    const touched = await dao.touch(ownerId, current.id, now);
    if (!touched) return { error: "NOT_FOUND" };
    return { recorded: true, created: false, alert: await viewOf(dao, ownerId, { ...current, updatedAt: now }) };
  }
  return { recorded: true, created: true, alert: toView(alert, [event]) };
}

async function changeStatus(
  db: DatabaseConnection,
  ownerId: string,
  alertId: string,
  status: Extract<AlertStatus, "acknowledged" | "snoozed">,
  clock: Clock,
) {
  return db.transaction(async (tx) => {
    const dao = new QualityAlertDao(tx);
    const alert = await dao.alertForOwner(ownerId, alertId);
    if (!alert) return { error: "NOT_FOUND" as const };
    if (alert.status === status) return { error: "ALERT_STATE_CONFLICT" as const };
    const preview = recordAlertOccurrence({
      brandId: alert.brandId,
      kind: alert.kind,
      windowId: alert.windowId,
      status: alert.status,
      occurrences: [],
    }, status, "status");
    if (!preview || preview.status !== status) return { error: "ALERT_STATE_CONFLICT" as const };
    const now = clock();
    const updated = await dao.setStatus(ownerId, alert.id, alert.status, status, now);
    if (!updated) return { error: "ALERT_STATE_CONFLICT" as const };
    return { alert: await viewOf(dao, ownerId, { ...alert, status, updatedAt: now }) };
  });
}

export function acknowledgeQualityAlert(
  db: DatabaseConnection,
  ownerId: string,
  alertId: string,
  clock: Clock = systemClock,
) {
  return changeStatus(db, ownerId, alertId, "acknowledged", clock);
}

export function snoozeQualityAlert(
  db: DatabaseConnection,
  ownerId: string,
  alertId: string,
  clock: Clock = systemClock,
) {
  return changeStatus(db, ownerId, alertId, "snoozed", clock);
}
