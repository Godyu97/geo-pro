import "server-only";

import { randomUUID } from "node:crypto";
import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { analysisRuleVersion, classifyLabels, fingerprintAnswer, normalizeUrl } from "../evidence/rules.ts";
import { resolveSamplingConditions } from "../evidence/contracts.ts";
import { EvidenceDao, type AnalysisRow, type CitationRow, type ObservationRow } from "../evidence/dao.ts";
import { invalidateEvidenceOverview } from "../evidence/overview-cache.ts";
import { PromptDao } from "../prompts/dao.ts";
import { authorizeBrandActor, workspaceBrand } from "../team-access/brand-scope.ts";
import { brandDutyAllows } from "../team-access/rules.ts";
import type {
  CaptureError,
  ConfirmCaptureAttemptInput,
  CreateCaptureSheetInput,
  DegradeCaptureSheetInput,
  RecordCaptureAttemptInput,
} from "./contracts.ts";
import {
  CaptureDao,
  type CaptureAttemptRecord,
  type CaptureConfirmPatch,
  type CaptureObservationSummary,
  type CaptureSheetRecord,
} from "./dao.ts";
import { degradeEntry, effortComparison } from "./effort.ts";
import { assistedCapture, confirmCapture } from "./rules.ts";

type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();
const credentialPattern = /password|passwd|session[_-]?token|cookie|authorization/i;

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
  promptId: string | null;
  questionText: string | null;
  answerText: string | null;
  citations: string[];
  citationSetState: CaptureAttemptRecord["citationSetState"];
  locatorRef: string | null;
  collectorId: string | null;
  requestedNetworkMode: CaptureAttemptRecord["requestedNetworkMode"];
  targetRegion: string | null;
  observedRegion: CaptureAttemptRecord["observedRegion"];
  newSession: CaptureAttemptRecord["newSession"];
  productMode: CaptureAttemptRecord["productMode"];
  observationId: string | null;
  observationState: CaptureObservationSummary["evidenceState"] | null;
  observationCitationState: CaptureObservationSummary["citationSetState"] | null;
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

export type CapturePromptSet = {
  id: string;
  version: number;
  createdAt: string;
  questions: Array<{ id: string; text: string; type: string }>;
};

type SheetResult = { sheet: CaptureSheetView } | { error: Extract<CaptureError, "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT"> };
type ListResult = { sheets: CaptureSheetView[] } | { error: "NOT_FOUND" };

function toAttempt(
  row: CaptureAttemptRecord,
  observations?: ReadonlyMap<string, CaptureObservationSummary>,
): CaptureAttemptView {
  const ruled = assistedCapture({ blockedBy: row.blockedBy, citationCount: row.citationCount });
  const confirmation = confirmCapture(ruled.status, row.confirmed === 1);
  const summary = row.observationId ? observations?.get(row.observationId) : undefined;
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
    promptId: row.promptId,
    questionText: row.questionText,
    answerText: row.answerText,
    citations: row.citations,
    citationSetState: row.citationSetState,
    locatorRef: row.locatorRef,
    collectorId: row.collectorId,
    requestedNetworkMode: row.requestedNetworkMode,
    targetRegion: row.targetRegion,
    observedRegion: row.observedRegion,
    newSession: row.newSession,
    productMode: row.productMode,
    observationId: row.observationId,
    observationState: summary?.evidenceState ?? null,
    observationCitationState: summary?.citationSetState ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSheet(
  row: CaptureSheetRecord,
  attempts: readonly CaptureAttemptRecord[],
  observations?: ReadonlyMap<string, CaptureObservationSummary>,
): CaptureSheetView {
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
    attempts: attempts
      .filter((attempt) => attempt.sheetId === row.id)
      .map((attempt) => toAttempt(attempt, observations)),
  };
}

export type CaptureWorkspaceView =
  | {
    brand: { id: string; name: string; region: string; language: string } | null;
    canWrite: boolean;
    promptSets: CapturePromptSet[];
    sheets: CaptureSheetView[];
  }
  | { error: "NOT_FOUND" };

async function writeAccess(db: QueryConnection, actorId: string, brandId: string, now: string) {
  const access = await authorizeBrandActor(db, actorId, brandId, "write", now);
  if (access) return access;
  const read = await authorizeBrandActor(db, actorId, brandId, "read", now);
  return { error: (read ? "FORBIDDEN" : "NOT_FOUND") as "FORBIDDEN" | "NOT_FOUND" };
}

function hasCredentialText(...values: Array<string | null | undefined>) {
  return values.some((value) => value && credentialPattern.test(value));
}

async function findPromptText(db: QueryConnection, brandId: string, promptId: string) {
  const versions = await new PromptDao(db, brandId).versions();
  for (const version of versions) {
    const match = version.content.questions.find((item) => item.id === promptId);
    if (match?.text.trim()) return match.text.trim();
  }
  return null;
}

function buildCaptureCitations(
  observationId: string,
  brandId: string,
  createdAt: string,
  urls: readonly string[],
): CitationRow[] {
  const seen = new Set<string>();
  const rows: CitationRow[] = [];
  for (const [index, rawUrl] of urls.entries()) {
    const normalizedUrl = normalizeUrl(rawUrl);
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    rows.push({
      id: randomUUID(),
      observationId,
      brandId,
      rawUrl,
      normalizedUrl,
      citationOrigin: "consumer_visible",
      positionLabel: String(index + 1),
      ownership: "unknown",
      pageStatus: "unknown",
      createdAt,
    });
  }
  return rows;
}

export async function readCaptureWorkspace(db: DatabaseConnection, ownerId: string, requestedBrandId?: string): Promise<CaptureWorkspaceView> {
  return db.transaction(async (tx) => {
    const scope = await workspaceBrand(tx, ownerId, requestedBrandId, "read");
    if (!scope) {
      return requestedBrandId ? { error: "NOT_FOUND" } : { brand: null, canWrite: false, promptSets: [], sheets: [] };
    }
    const brand = await new BrandDao(tx).version(scope.ownerId, scope.brandId);
    if (!brand) {
      return requestedBrandId ? { error: "NOT_FOUND" } : { brand: null, canWrite: false, promptSets: [], sheets: [] };
    }
    const dao = new CaptureDao(tx);
    const [versions, sheets] = await Promise.all([
      new PromptDao(tx, scope.brandId).versions(),
      dao.sheetsForBrand(scope.ownerId, scope.brandId),
    ]);
    const attempts = await dao.attemptsForSheets(scope.ownerId, sheets.map((sheet) => sheet.id));
    const observations = await dao.observationSummaries(
      scope.ownerId,
      scope.brandId,
      attempts.flatMap((attempt) => attempt.observationId ? [attempt.observationId] : []),
    );
    return {
      brand: {
        id: brand.id,
        name: brand.fields.name,
        region: brand.fields.region,
        language: brand.fields.language,
      },
      canWrite: brandDutyAllows(scope.role, "write"),
      promptSets: versions.map((item) => ({
        id: item.id,
        version: item.version,
        createdAt: item.createdAt,
        questions: item.content.questions.map((question) => ({
          id: question.id,
          text: question.text,
          type: question.type,
        })),
      })),
      sheets: sheets.map((sheet) => toSheet(sheet, attempts, observations)),
    };
  });
}

export async function listCaptureSheets(db: DatabaseConnection, ownerId: string, brandId: string): Promise<ListResult> {
  return db.transaction(async (tx) => {
    const access = await authorizeBrandActor(tx, ownerId, brandId, "read");
    if (!access) return { error: "NOT_FOUND" as const };
    const dao = new CaptureDao(tx);
    const sheets = await dao.sheetsForBrand(access.ownerId, brandId);
    const attempts = await dao.attemptsForSheets(access.ownerId, sheets.map((sheet) => sheet.id));
    const observations = await dao.observationSummaries(
      access.ownerId,
      brandId,
      attempts.flatMap((attempt) => attempt.observationId ? [attempt.observationId] : []),
    );
    return { sheets: sheets.map((sheet) => toSheet(sheet, attempts, observations)) };
  });
}

export async function getCaptureSheet(db: DatabaseConnection, ownerId: string, sheetId: string): Promise<SheetResult> {
  return db.transaction(async (tx) => {
    const dao = new CaptureDao(tx);
    const scope = await dao.sheetScope(sheetId);
    if (!scope) return { error: "NOT_FOUND" as const };
    const access = await authorizeBrandActor(tx, ownerId, scope.brandId, "read");
    if (!access || access.ownerId !== scope.ownerId) return { error: "NOT_FOUND" as const };
    const sheet = await dao.sheetForOwner(access.ownerId, sheetId, false);
    if (!sheet) return { error: "NOT_FOUND" as const };
    const attempts = await dao.attemptsForSheet(access.ownerId, sheet.id);
    const observations = await dao.observationSummaries(
      access.ownerId,
      sheet.brandId,
      attempts.flatMap((attempt) => attempt.observationId ? [attempt.observationId] : []),
    );
    return { sheet: toSheet(sheet, attempts, observations) };
  });
}

export async function createCaptureSheet(
  db: DatabaseConnection,
  ownerId: string,
  input: CreateCaptureSheetInput,
  clock: Clock = systemClock,
): Promise<SheetResult> {
  return db.transaction(async (tx) => {
    const now = clock();
    const access = await writeAccess(tx, ownerId, input.brandId, now);
    if ("error" in access) return access;
    const sheet: CaptureSheetRecord = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId: access.ownerId,
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
    const now = clock();
    const dao = new CaptureDao(tx);
    const scope = await dao.sheetScope(input.sheetId);
    if (!scope) return { error: "NOT_FOUND" as const };
    const access = await writeAccess(tx, ownerId, scope.brandId, now);
    if ("error" in access) return access;
    if (access.ownerId !== scope.ownerId) return { error: "NOT_FOUND" as const };

    const sheet = await dao.sheetForOwner(access.ownerId, input.sheetId, true);
    if (!sheet) return { error: "NOT_FOUND" as const };

    const answerText = input.answerText?.trim() ? input.answerText : null;
    const locatorRef = input.locatorRef?.trim() || null;
    const collectorId = input.collectorId?.trim() || null;
    if (hasCredentialText(input.questionText, answerText, locatorRef, collectorId)) {
      return { error: "INVALID_INPUT" as const };
    }
    if (input.promptId && !sheet.promptIds.includes(input.promptId)) {
      return { error: "INVALID_INPUT" as const };
    }

    const citations = input.citations ?? [];
    const effectiveCitationCount = citations.length > 0
      ? Math.max(input.citationCount, citations.length)
      : input.citationCount;

    let questionText = input.questionText?.trim() || null;
    if (!questionText && input.promptId) {
      questionText = await findPromptText(tx, sheet.brandId, input.promptId);
    }

    let normalizedTargetRegion: string | null = null;
    let normalizedObservedRegion = input.observedRegion ?? null;
    if (input.targetRegion || input.observedRegion || input.newSession || input.productMode) {
      const regionSeed = input.targetRegion ?? "US";
      const conditions = resolveSamplingConditions({
        region: regionSeed,
        targetRegion: regionSeed,
        observedRegion: input.observedRegion ?? "unknown",
        newSession: input.newSession ?? "unknown",
        productMode: input.productMode ?? "unknown",
      });
      if (!conditions) return { error: "INVALID_INPUT" as const };
      if (input.targetRegion) normalizedTargetRegion = conditions.targetRegion;
      if (input.observedRegion) normalizedObservedRegion = conditions.observedRegion as CaptureAttemptRecord["observedRegion"];
    }

    const ruled = assistedCapture({ blockedBy: input.blockedBy, citationCount: effectiveCitationCount });
    await dao.insertAttempt({
      id: randomUUID(),
      sheetId: sheet.id,
      brandId: sheet.brandId,
      ownerId: access.ownerId,
      blockedBy: input.blockedBy,
      citationCount: effectiveCitationCount,
      status: ruled.status,
      confirmed: 0,
      createdAt: now,
      updatedAt: now,
      promptId: input.promptId ?? null,
      questionText,
      answerText,
      citationsJson: citations.length > 0 ? JSON.stringify(citations) : null,
      citationSetState: input.citationSetState ?? null,
      locatorRef,
      collectorId,
      requestedNetworkMode: input.requestedNetworkMode ?? null,
      targetRegion: normalizedTargetRegion,
      observedRegion: normalizedObservedRegion,
      newSession: input.newSession ?? null,
      productMode: input.productMode ?? null,
      observationId: null,
    });
    const attempts = await dao.attemptsForSheet(access.ownerId, sheet.id);
    const observations = await dao.observationSummaries(
      access.ownerId,
      sheet.brandId,
      attempts.flatMap((attempt) => attempt.observationId ? [attempt.observationId] : []),
    );
    return { sheet: toSheet(sheet, attempts, observations) };
  });
}

export async function confirmCaptureAttempt(
  db: DatabaseConnection,
  ownerId: string,
  attemptId: string,
  input: ConfirmCaptureAttemptInput,
  clock: Clock = systemClock,
  cache?: CacheStore,
): Promise<SheetResult> {
  const outcome = await db.transaction(async (tx): Promise<{
    result: SheetResult;
    createdObservation: { ownerId: string; brandId: string } | null;
  }> => {
    let createdObservation: { ownerId: string; brandId: string } | null = null;
    const now = clock();
    const dao = new CaptureDao(tx);
    const scope = await dao.attemptScope(attemptId);
    if (!scope) return { result: { error: "NOT_FOUND" as const }, createdObservation };
    const access = await writeAccess(tx, ownerId, scope.brandId, now);
    if ("error" in access) return { result: access, createdObservation };
    if (access.ownerId !== scope.ownerId) return { result: { error: "NOT_FOUND" as const }, createdObservation };

    const attempt = await dao.attemptForOwner(access.ownerId, attemptId, true);
    if (!attempt) return { result: { error: "NOT_FOUND" as const }, createdObservation };
    const sheet = await dao.sheetForOwner(access.ownerId, attempt.sheetId, true);
    if (!sheet) return { result: { error: "NOT_FOUND" as const }, createdObservation };

    const mergedPromptId = input.promptId !== undefined ? input.promptId : attempt.promptId;
    if (mergedPromptId && !sheet.promptIds.includes(mergedPromptId)) {
      return { result: { error: "INVALID_INPUT" as const }, createdObservation };
    }
    const mergedQuestionText = input.questionText !== undefined
      ? (input.questionText?.trim() || null)
      : attempt.questionText;
    const mergedAnswerText = input.answerText !== undefined
      ? (input.answerText ?? "")
      : (attempt.answerText ?? "");
    const mergedLocatorRef = input.locatorRef !== undefined
      ? (input.locatorRef?.trim() || null)
      : attempt.locatorRef;
    const mergedCollectorId = input.collectorId !== undefined
      ? (input.collectorId?.trim() || null)
      : attempt.collectorId;
    const mergedCitations = input.citations !== undefined ? input.citations : attempt.citations;
    const mergedCitationCount = input.citations !== undefined
      ? Math.max(attempt.citationCount, mergedCitations.length)
      : attempt.citationCount;

    if (hasCredentialText(mergedQuestionText, mergedAnswerText, mergedLocatorRef, mergedCollectorId)) {
      return { result: { error: "INVALID_INPUT" as const }, createdObservation };
    }

    const ruled = assistedCapture({ blockedBy: attempt.blockedBy, citationCount: mergedCitationCount });
    const decision = confirmCapture(ruled.status, input.confirmed);
    if (decision.saved && attempt.confirmed === 0) {
      if (mergedAnswerText.trim().length > 0) {
        const brand = await new BrandDao(tx).version(access.ownerId, sheet.brandId);
        if (!brand || brand.status !== "active") return { result: { error: "NOT_FOUND" as const }, createdObservation };

        const resolvedQuestionText = mergedQuestionText
          || (mergedPromptId ? await findPromptText(tx, sheet.brandId, mergedPromptId) : null)
          || mergedPromptId
          || sheet.promptIds[0];

        const targetRegionInput = input.targetRegion ?? attempt.targetRegion ?? brand.fields.region;
        const conditions = resolveSamplingConditions({
          region: targetRegionInput,
          targetRegion: targetRegionInput,
          observedRegion: input.observedRegion ?? attempt.observedRegion ?? "unknown",
          newSession: input.newSession ?? attempt.newSession ?? "unknown",
          productMode: input.productMode ?? attempt.productMode ?? "unknown",
        });
        if (!conditions) return { result: { error: "INVALID_INPUT" as const }, createdObservation };

        const requestedNetworkMode = input.requestedNetworkMode ?? attempt.requestedNetworkMode ?? "unknown";
        const requestedCitationState = input.citationSetState ?? attempt.citationSetState;
        const citationSetState: ObservationRow["citationSetState"] = ruled.status === "partial" || mergedCitations.length === 0
          ? (requestedCitationState === "missing" || requestedCitationState === "unsupported"
            ? requestedCitationState
            : "partial")
          : (requestedCitationState ?? "complete");

        const missingCitation = citationSetState === "missing";
        const missingLocator = !mergedLocatorRef;
        const missingCollector = !mergedCollectorId;
        const incomplete = missingCitation || missingLocator || missingCollector;
        const evidenceState: ObservationRow["evidenceState"] = incomplete
          ? "draft_evidence"
          : input.contested
            ? "contested"
            : "complete";
        const missingReason = incomplete
          ? [
            missingCitation ? "citation-fields-missing" : null,
            missingLocator ? "locator-missing" : null,
            missingCollector ? "collector-missing" : null,
          ].filter(Boolean).join(",")
          : null;

        const observationId = randomUUID();
        const citations = evidenceState === "draft_evidence" && citationSetState === "missing"
          ? []
          : buildCaptureCitations(observationId, sheet.brandId, now, mergedCitations);
        const observation: ObservationRow = {
          id: observationId,
          brandId: sheet.brandId,
          ownerId: access.ownerId,
          slotId: null,
          attemptId: null,
          sourceMode: "consumer_ui",
          captureMethod: sheet.mode === "manual" ? "manual" : "assisted",
          questionText: resolvedQuestionText,
          answerText: mergedAnswerText,
          fingerprint: fingerprintAnswer(resolvedQuestionText, mergedAnswerText),
          capturedAt: now,
          region: conditions.region,
          targetRegion: conditions.targetRegion,
          observedRegion: conditions.observedRegion,
          newSession: conditions.newSession,
          productMode: conditions.productMode,
          networkTrigger: "unknown",
          language: brand.fields.language,
          requestedNetworkMode,
          entityVersion: brand.entityVersion,
          citationSetState,
          evidenceState,
          locatorRef: mergedLocatorRef,
          collectorId: mergedCollectorId,
          missingReason,
          createdAt: now,
        };

        const evidenceDao = new EvidenceDao(tx);
        await evidenceDao.insertObservation(observation);
        await evidenceDao.insertCitations(citations);
        if (evidenceState === "complete" || evidenceState === "contested") {
          const labels = classifyLabels({
            answerText: mergedAnswerText,
            brandName: brand.fields.name,
            aliases: brand.fields.aliases,
            officialWebsite: brand.fields.website || null,
            citations,
          });
          const analysis: AnalysisRow = {
            id: randomUUID(),
            observationId,
            brandId: sheet.brandId,
            version: 1,
            entityVersion: brand.entityVersion,
            ruleVersion: analysisRuleVersion,
            mentioned: labels.mentioned,
            recommended: labels.recommended,
            officialSiteCited: labels.officialSiteCited,
            evidenceSpan: labels.evidenceSpan,
            status: evidenceState === "contested" ? "needs_review" : labels.status,
            revisedFrom: null,
            reason: null,
            reviewerId: null,
            createdAt: now,
          };
          await evidenceDao.insertAnalysis(analysis);
        }

        const patch: CaptureConfirmPatch = {
          citationCount: mergedCitationCount,
          status: ruled.status === "preview" ? "preview" : "partial",
          promptId: mergedPromptId ?? null,
          questionText: resolvedQuestionText,
          answerText: mergedAnswerText,
          citationsJson: mergedCitations.length > 0 ? JSON.stringify(mergedCitations) : null,
          citationSetState,
          locatorRef: mergedLocatorRef,
          collectorId: mergedCollectorId,
          requestedNetworkMode,
          targetRegion: conditions.targetRegion,
          observedRegion: conditions.observedRegion as CaptureAttemptRecord["observedRegion"],
          newSession: conditions.newSession,
          productMode: conditions.productMode,
          observationId,
        };
        const wrote = await dao.markConfirmed(access.ownerId, attempt.id, now, patch);
        if (!wrote) return { result: { error: "NOT_FOUND" as const }, createdObservation };
        createdObservation = { ownerId: access.ownerId, brandId: sheet.brandId };
      } else {
        const wrote = await dao.markConfirmed(access.ownerId, attempt.id, now);
        if (!wrote) return { result: { error: "NOT_FOUND" as const }, createdObservation };
      }
    }
    const attempts = await dao.attemptsForSheet(access.ownerId, sheet.id);
    const observations = await dao.observationSummaries(
      access.ownerId,
      sheet.brandId,
      attempts.flatMap((item) => item.observationId ? [item.observationId] : []),
    );
    return { result: { sheet: toSheet(sheet, attempts, observations) }, createdObservation };
  });

  if (outcome.createdObservation) {
    await invalidateEvidenceOverview(outcome.createdObservation.ownerId, outcome.createdObservation.brandId, cache ?? openCache());
  }
  return outcome.result;
}

export async function degradeCaptureSheet(
  db: DatabaseConnection,
  ownerId: string,
  sheetId: string,
  input: DegradeCaptureSheetInput,
  clock: Clock = systemClock,
): Promise<SheetResult> {
  return db.transaction(async (tx) => {
    const now = clock();
    const dao = new CaptureDao(tx);
    const scope = await dao.sheetScope(sheetId);
    if (!scope) return { error: "NOT_FOUND" as const };
    const access = await writeAccess(tx, ownerId, scope.brandId, now);
    if ("error" in access) return access;
    if (access.ownerId !== scope.ownerId) return { error: "NOT_FOUND" as const };

    const sheet = await dao.sheetForOwner(access.ownerId, sheetId, true);
    if (!sheet) return { error: "NOT_FOUND" as const };
    const entry = degradeEntry({ structureChanged: input.structureChanged });
    let current = sheet;
    if (entry.mode === "manual" && sheet.mode === "assisted") {
      const wrote = await dao.writeMode(access.ownerId, sheet.id, "manual", now);
      if (!wrote) return { error: "NOT_FOUND" as const };
      current = { ...sheet, mode: "manual", updatedAt: now };
    }
    const attempts = await dao.attemptsForSheet(access.ownerId, sheet.id);
    const observations = await dao.observationSummaries(
      access.ownerId,
      sheet.brandId,
      attempts.flatMap((attempt) => attempt.observationId ? [attempt.observationId] : []),
    );
    return { sheet: toSheet(current, attempts, observations) };
  });
}
