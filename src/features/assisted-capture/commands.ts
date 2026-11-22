import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import type {
  ConfirmCaptureAttemptInput,
  CreateCaptureSheetInput,
  DegradeCaptureSheetInput,
  RecordCaptureAttemptInput,
} from "./contracts.ts";
import { CaptureDao, type CaptureAttemptRecord, type CaptureSheetRecord } from "./dao.ts";
import { degradeEntry, effortComparison } from "./effort.ts";
import { assistedCapture, confirmCapture } from "./rules.ts";

type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

export type CaptureAttemptView = {
  id: string;
  blockedBy: CaptureAttemptRecord["blockedBy"];
  citationCount: number;
  status: CaptureAttemptRecord["status"];
  confirmed: boolean;
  bypass: boolean;
  complete: boolean;
  silentEmptyCitations: boolean;
  saved: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CaptureSheetView = {
  id: string;
  brandId: string;
  promptIds: string[];
  mode: CaptureSheetRecord["mode"];
  assistedMinutes: number | null;
  manualMinutes: number | null;
  citationsComplete: boolean;
  savedMinutes: number | null;
  comparable: boolean;
  switchedAccount: boolean;
  manualStillAvailable: boolean;
  createdAt: string;
  updatedAt: string;
  attempts: CaptureAttemptView[];
};

type SheetResult = { sheet: CaptureSheetView } | { error: "NOT_FOUND" };
type ListResult = { sheets: CaptureSheetView[] } | { error: "NOT_FOUND" };

function toAttempt(row: CaptureAttemptRecord): CaptureAttemptView {
  const ruled = assistedCapture({ blockedBy: row.blockedBy, citationCount: row.citationCount });
  const confirmation = confirmCapture(ruled.status, row.confirmed === 1);
  return {
    id: row.id,
    blockedBy: row.blockedBy,
    citationCount: row.citationCount,
    status: ruled.status,
    confirmed: row.confirmed === 1,
    bypass: ruled.bypass,
    complete: confirmation.complete,
    silentEmptyCitations: ruled.silentEmptyCitations,
    saved: confirmation.saved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSheet(row: CaptureSheetRecord, attempts: readonly CaptureAttemptRecord[]): CaptureSheetView {
  const effort = effortComparison({
    assistedMinutes: row.assistedMinutes,
    manualMinutes: row.manualMinutes,
    citationsComplete: row.citationsComplete === 1,
  });
  const entry = degradeEntry({ structureChanged: row.mode === "manual" });
  return {
    id: row.id,
    brandId: row.brandId,
    promptIds: row.promptIds,
    mode: row.mode,
    assistedMinutes: row.assistedMinutes,
    manualMinutes: row.manualMinutes,
    citationsComplete: row.citationsComplete === 1,
    savedMinutes: effort.savedMinutes,
    comparable: effort.comparable,
    switchedAccount: entry.switchedAccount,
    manualStillAvailable: entry.manualStillAvailable,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    attempts: attempts.filter((attempt) => attempt.sheetId === row.id).map(toAttempt),
  };
}

export async function listCaptureSheets(db: DatabaseConnection, ownerId: string, brandId: string): Promise<ListResult> {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const dao = new CaptureDao(tx);
    const sheets = await dao.sheetsForBrand(ownerId, brandId);
    const attempts = await dao.attemptsForSheets(ownerId, sheets.map((sheet) => sheet.id));
    return { sheets: sheets.map((sheet) => toSheet(sheet, attempts)) };
  });
}

export async function getCaptureSheet(db: DatabaseConnection, ownerId: string, sheetId: string): Promise<SheetResult> {
  return db.transaction(async (tx) => {
    const dao = new CaptureDao(tx);
    const sheet = await dao.sheetForOwner(ownerId, sheetId, false);
    if (!sheet) return { error: "NOT_FOUND" as const };
    const owned = await new BrandDao(tx).owned(ownerId, sheet.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const attempts = await dao.attemptsForSheet(ownerId, sheet.id);
    return { sheet: toSheet(sheet, attempts) };
  });
}

export async function createCaptureSheet(
  db: DatabaseConnection,
  ownerId: string,
  input: CreateCaptureSheetInput,
  clock: Clock = systemClock,
): Promise<SheetResult> {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const now = clock();
    const sheet: CaptureSheetRecord = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId,
      promptIdsJson: JSON.stringify(input.promptIds),
      promptIds: input.promptIds,
      mode: "assisted",
      assistedMinutes: input.assistedMinutes,
      manualMinutes: input.manualMinutes,
      citationsComplete: input.citationsComplete ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    };
    await new CaptureDao(tx).insertSheet(sheet);
    return { sheet: toSheet(sheet, []) };
  });
}

export async function recordCaptureAttempt(
  db: DatabaseConnection,
  ownerId: string,
  input: RecordCaptureAttemptInput,
  clock: Clock = systemClock,
): Promise<SheetResult> {
  return db.transaction(async (tx) => {
    const dao = new CaptureDao(tx);
    const sheet = await dao.sheetForOwner(ownerId, input.sheetId, true);
    if (!sheet) return { error: "NOT_FOUND" as const };
    const owned = await new BrandDao(tx).owned(ownerId, sheet.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const now = clock();
    const ruled = assistedCapture({ blockedBy: input.blockedBy, citationCount: input.citationCount });
    await dao.insertAttempt({
      id: randomUUID(),
      sheetId: sheet.id,
      brandId: sheet.brandId,
      ownerId,
      blockedBy: input.blockedBy,
      citationCount: input.citationCount,
      status: ruled.status,
      confirmed: 0,
      createdAt: now,
      updatedAt: now,
    });
    const attempts = await dao.attemptsForSheet(ownerId, sheet.id);
    return { sheet: toSheet(sheet, attempts) };
  });
}

export async function confirmCaptureAttempt(
  db: DatabaseConnection,
  ownerId: string,
  attemptId: string,
  input: ConfirmCaptureAttemptInput,
  clock: Clock = systemClock,
): Promise<SheetResult> {
  return db.transaction(async (tx) => {
    const dao = new CaptureDao(tx);
    const attempt = await dao.attemptForOwner(ownerId, attemptId, true);
    if (!attempt) return { error: "NOT_FOUND" as const };
    const sheet = await dao.sheetForOwner(ownerId, attempt.sheetId, true);
    if (!sheet) return { error: "NOT_FOUND" as const };
    const owned = await new BrandDao(tx).owned(ownerId, sheet.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const ruled = assistedCapture({ blockedBy: attempt.blockedBy, citationCount: attempt.citationCount });
    const decision = confirmCapture(ruled.status, input.confirmed);
    if (decision.saved && attempt.confirmed === 0) {
      const wrote = await dao.markConfirmed(ownerId, attempt.id, clock());
      if (!wrote) return { error: "NOT_FOUND" as const };
    }
    const attempts = await dao.attemptsForSheet(ownerId, sheet.id);
    return { sheet: toSheet(sheet, attempts) };
  });
}

export async function degradeCaptureSheet(
  db: DatabaseConnection,
  ownerId: string,
  sheetId: string,
  input: DegradeCaptureSheetInput,
  clock: Clock = systemClock,
): Promise<SheetResult> {
  return db.transaction(async (tx) => {
    const dao = new CaptureDao(tx);
    const sheet = await dao.sheetForOwner(ownerId, sheetId, true);
    if (!sheet) return { error: "NOT_FOUND" as const };
    const owned = await new BrandDao(tx).owned(ownerId, sheet.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const entry = degradeEntry({ structureChanged: input.structureChanged });
    let current = sheet;
    if (entry.mode === "manual" && sheet.mode === "assisted") {
      const now = clock();
      const wrote = await dao.writeMode(ownerId, sheet.id, "manual", now);
      if (!wrote) return { error: "NOT_FOUND" as const };
      current = { ...sheet, mode: "manual", updatedAt: now };
    }
    const attempts = await dao.attemptsForSheet(ownerId, sheet.id);
    return { sheet: toSheet(current, attempts) };
  });
}
