import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { PromptDao } from "../prompts/dao.ts";
import {
  type EvidenceError,
  type IngestAdoptedInput,
  type ReviseAnalysisInput,
  type SubmitManualInput,
  qualifiesForC,
} from "./contracts.ts";
import { EvidenceDao, type AnalysisRow, type CitationRow, type ObservationRow } from "./dao.ts";
import { invalidateEvidenceOverview } from "./overview-cache.ts";
import {
  analysisRuleVersion,
  citationPoolEligibility,
  classifyLabels,
  fingerprintAnswer,
  normalizeUrl,
} from "./rules.ts";

type Failure = { error: EvidenceError; next?: string | null };
type Clock = () => string;

function denied(error: EvidenceError, next?: string | null): Failure {
  return { error, next: next ?? null };
}

function wroteObservation(result: unknown): result is { observation: unknown } {
  return result !== null && typeof result === "object" && "observation" in result;
}

export async function releaseOverview<T>(ownerId: string, brandId: string, result: T, cache?: CacheStore) {
  if (wroteObservation(result)) await invalidateEvidenceOverview(ownerId, brandId, cache ?? openCache());
  return result;
}

function operationFingerprint(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

async function owned(dao: EvidenceDao, ownerId: string, brandId: string) {
  const brand = await dao.lockBrand(brandId, ownerId);
  if (!brand) return denied("NOT_FOUND");
  if (brand.status !== "active" || brand.frozen === 1) return denied("NOT_ENTITLED");
  return brand;
}

function buildCitations(
  observationId: string,
  brandId: string,
  createdAt: string,
  citations: Array<{
    rawUrl: string;
    normalizedUrl?: string;
    citationOrigin: CitationRow["citationOrigin"];
    positionLabel?: string | null;
    ownership?: CitationRow["ownership"];
    pageStatus?: CitationRow["pageStatus"];
  }>,
): CitationRow[] {
  return citations.map((item) => ({
    id: randomUUID(),
    observationId,
    brandId,
    rawUrl: item.rawUrl,
    normalizedUrl: item.normalizedUrl ?? normalizeUrl(item.rawUrl),
    citationOrigin: item.citationOrigin,
    positionLabel: item.positionLabel ?? null,
    ownership: item.ownership ?? "unknown",
    pageStatus: item.pageStatus ?? "unknown",
    createdAt,
  }));
}

function detailPayload(
  observation: ObservationRow,
  citations: CitationRow[],
  analyses: AnalysisRow[],
) {
  const latest = analyses.at(-1) ?? null;
  const pool = citationPoolEligibility(observation.citationSetState);
  return {
    observation,
    citations,
    analyses,
    latestAnalysis: latest,
    citationPool: {
      inC: pool.inC,
      cited: qualifiesForC(observation.citationSetState) && citations.some(
        (item) => item.citationOrigin === "provider_native" || item.citationOrigin === "consumer_visible",
      ),
      reason: pool.reason,
    },
  };
}

export async function ingestAdoptedObservation(
  db: DatabaseConnection,
  ownerId: string,
  input: IngestAdoptedInput,
  clock: Clock = () => new Date().toISOString(),
  cache?: CacheStore,
) {
  const result = await db.transaction(async (tx) => {
    const dao = new EvidenceDao(tx);
    const existing = await dao.operation(ownerId, input.operationId);
    if (existing) return JSON.parse(existing) as ReturnType<typeof detailPayload> & { replayed: true };

    const brand = await owned(dao, ownerId, input.brandId);
    if ("error" in brand) return brand;

    const adopted = await dao.adoptedAttempt(ownerId, input.brandId, input.slotId);
    if (!adopted?.rawText) return denied("NOT_FOUND");

    const prior = await dao.observationBySlot(ownerId, input.brandId, input.slotId);
    if (prior && prior.evidenceState !== "draft_evidence") return denied("OPERATION_CONFLICT");

    const prompt = await new PromptDao(tx, input.brandId).version(adopted.promptSetId);
    const questionText = prompt?.content.questions.find((item) => item.id === adopted.questionId)?.text
      ?? adopted.questionId;

    const now = clock();
    const observationId = randomUUID();
    const citations = buildCitations(observationId, input.brandId, now, input.citations ?? []);
    const citationSetState = input.citationSetState
      ?? (input.citations ? "complete" : "missing");
    const labels = classifyLabels({
      answerText: adopted.rawText,
      brandName: input.brandName,
      aliases: input.aliases,
      officialWebsite: input.officialWebsite,
      citations,
      mentioned: input.mentioned,
      recommended: input.recommended,
      officialSiteCited: input.officialSiteCited,
    });

    const observation: ObservationRow = {
      id: observationId,
      brandId: input.brandId,
      ownerId,
      slotId: input.slotId,
      attemptId: adopted.attemptId,
      sourceMode: adopted.track,
      captureMethod: adopted.transport === "isolated" ? "isolated" : "official_api",
      questionText,
      answerText: adopted.rawText,
      fingerprint: fingerprintAnswer(questionText, adopted.rawText),
      capturedAt: now,
      region: adopted.region,
      language: adopted.language,
      requestedNetworkMode: adopted.requestedNetworkMode,
      entityVersion: adopted.entityVersion,
      citationSetState,
      evidenceState: "complete",
      locatorRef: null,
      collectorId: null,
      missingReason: citationSetState === "missing" ? "citation-fields-missing" : null,
      createdAt: now,
    };

    const analysis: AnalysisRow = {
      id: randomUUID(),
      observationId,
      brandId: input.brandId,
      version: 1,
      entityVersion: adopted.entityVersion,
      ruleVersion: analysisRuleVersion,
      mentioned: labels.mentioned,
      recommended: labels.recommended,
      officialSiteCited: labels.officialSiteCited,
      evidenceSpan: input.evidenceSpan ?? labels.evidenceSpan,
      status: labels.status,
      revisedFrom: null,
      reason: null,
      reviewerId: null,
      createdAt: now,
    };

    await dao.insertObservation(observation);
    await dao.insertCitations(citations);
    await dao.insertAnalysis(analysis);
    const payload = { ...detailPayload(observation, citations, [analysis]), replayed: false as const };
    await dao.recordOperation(ownerId, input.operationId, operationFingerprint(input), payload, now, input.brandId);
    return payload;
  });
  return releaseOverview(ownerId, input.brandId, result, cache);
}

export async function submitManualEvidence(
  db: DatabaseConnection,
  ownerId: string,
  input: SubmitManualInput,
  clock: Clock = () => new Date().toISOString(),
  cache?: CacheStore,
) {
  const result = await db.transaction(async (tx) => {
    const dao = new EvidenceDao(tx);
    const existing = await dao.operation(ownerId, input.operationId);
    if (existing) return JSON.parse(existing) as ReturnType<typeof detailPayload> & { replayed: true };

    const brand = await owned(dao, ownerId, input.brandId);
    if ("error" in brand) return brand;

    const forbidden = /password|passwd|session[_-]?token|cookie|authorization/i.test(
      `${input.answerText}\n${input.locatorRef ?? ""}`,
    );
    if (forbidden) return denied("INVALID_INPUT");

    const missingLocator = !input.locatorRef;
    const missingCollector = !input.collectorId;
    const incomplete = input.answerText.trim().length === 0
      || input.citationSetState === "missing"
      || missingLocator
      || missingCollector;
    const evidenceState = input.contested
      ? "contested"
      : incomplete
        ? "draft_evidence"
        : "complete";
    if (evidenceState === "draft_evidence" && input.answerText.trim().length === 0 && !input.locatorRef) {
      // drafts are allowed; callers may continue later
    }

    const now = clock();
    const observationId = randomUUID();
    const citations = evidenceState === "draft_evidence" && input.citationSetState === "missing"
      ? []
      : buildCitations(observationId, input.brandId, now, input.citations);
    const labels = classifyLabels({
      answerText: input.answerText,
      brandName: input.brandName,
      aliases: input.aliases,
      officialWebsite: input.officialWebsite,
      citations,
      mentioned: input.mentioned,
      recommended: input.recommended,
      officialSiteCited: input.officialSiteCited,
    });

    const observation: ObservationRow = {
      id: observationId,
      brandId: input.brandId,
      ownerId,
      slotId: input.slotId ?? null,
      attemptId: null,
      sourceMode: "consumer_ui",
      captureMethod: "manual",
      questionText: input.questionText,
      answerText: input.answerText,
      fingerprint: fingerprintAnswer(input.questionText, input.answerText),
      capturedAt: now,
      region: input.region,
      language: input.language,
      requestedNetworkMode: input.requestedNetworkMode,
      entityVersion: input.entityVersion,
      citationSetState: input.citationSetState,
      evidenceState,
      locatorRef: input.locatorRef ?? null,
      collectorId: input.collectorId ?? null,
      missingReason: incomplete
        ? [
            input.answerText.trim() ? null : "answer-missing",
            input.citationSetState === "missing" ? "citation-fields-missing" : null,
            missingLocator ? "locator-missing" : null,
            missingCollector ? "collector-missing" : null,
          ].filter(Boolean).join(",")
        : null,
      createdAt: now,
    };

    const analyses: AnalysisRow[] = [];
    if (evidenceState === "complete" || evidenceState === "contested") {
      analyses.push({
        id: randomUUID(),
        observationId,
        brandId: input.brandId,
        version: 1,
        entityVersion: input.entityVersion,
        ruleVersion: analysisRuleVersion,
        mentioned: labels.mentioned,
        recommended: labels.recommended,
        officialSiteCited: labels.officialSiteCited,
        evidenceSpan: input.evidenceSpan ?? labels.evidenceSpan,
        status: evidenceState === "contested" ? "needs_review" : labels.status,
        revisedFrom: null,
        reason: null,
        reviewerId: null,
        createdAt: now,
      });
    }

    await dao.insertObservation(observation);
    await dao.insertCitations(citations);
    for (const analysis of analyses) await dao.insertAnalysis(analysis);
    const payload = {
      ...detailPayload(observation, citations, analyses),
      replayed: false as const,
      incomplete: evidenceState === "draft_evidence",
    };
    await dao.recordOperation(ownerId, input.operationId, operationFingerprint(input), payload, now, input.brandId);
    if (evidenceState === "draft_evidence") {
      return { ...payload, error: "EVIDENCE_INCOMPLETE" as const };
    }
    return payload;
  });
  return releaseOverview(ownerId, input.brandId, result, cache);
}

export async function appendAnalysisRevision(
  tx: TransactionConnection,
  ownerId: string,
  input: ReviseAnalysisInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const dao = new EvidenceDao(tx);
  const existing = await dao.operation(ownerId, input.operationId);
  if (existing) return JSON.parse(existing) as ReturnType<typeof detailPayload> & { replayed: true };

  const brand = await owned(dao, ownerId, input.brandId);
  if ("error" in brand) return brand;

  const observation = await dao.observationForOwner(ownerId, input.observationId);
  if (!observation || observation.brandId !== input.brandId) return denied("NOT_FOUND");

  const latest = await dao.latestAnalysis(observation.id);
  if (!latest) return denied("NOT_FOUND");
  if (latest.version !== input.expectedVersion) return denied("VERSION_CONFLICT");

  const now = clock();
  await dao.markAnalysisRevised(latest.id, input.brandId);
  const analysis: AnalysisRow = {
    id: randomUUID(),
    observationId: observation.id,
    brandId: input.brandId,
    version: latest.version + 1,
    entityVersion: observation.entityVersion,
    ruleVersion: analysisRuleVersion,
    mentioned: input.mentioned,
    recommended: input.recommended,
    officialSiteCited: input.officialSiteCited,
    evidenceSpan: input.evidenceSpan ?? latest.evidenceSpan,
    status: input.recommended === "true" && input.mentioned === "false" ? "needs_review" : "classified",
    revisedFrom: latest.id,
    reason: input.reason,
    reviewerId: ownerId,
    createdAt: now,
  };
  await dao.insertAnalysis(analysis);
  const citations = await dao.citationsFor(observation.id);
  const analyses = await dao.analysesFor(observation.id);
  const payload = {
    ...detailPayload(observation, citations, analyses),
    replayed: false as const,
    previousAnalysisId: latest.id,
  };
  await dao.recordOperation(ownerId, input.operationId, operationFingerprint(input), payload, now, input.brandId);
  return payload;
}

export async function reviseAnalysis(
  db: DatabaseConnection,
  ownerId: string,
  input: ReviseAnalysisInput,
  clock: Clock = () => new Date().toISOString(),
  cache?: CacheStore,
) {
  const result = await db.transaction((tx) => appendAnalysisRevision(tx, ownerId, input, clock));
  return releaseOverview(ownerId, input.brandId, result, cache);
}

export async function readObservation(
  db: DatabaseConnection,
  ownerId: string,
  observationId: string,
) {
  const dao = new EvidenceDao(db);
  const observation = await dao.observationForOwner(ownerId, observationId);
  if (!observation) return null;
  const [citations, analyses, drafts] = await Promise.all([
    dao.citationsFor(observation.id),
    dao.analysesFor(observation.id),
    dao.openAnalysisDrafts(ownerId, observation.id),
  ]);
  return { ...detailPayload(observation, citations, analyses), drafts };
}

export async function readObservationBySlot(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  slotId: string,
) {
  const dao = new EvidenceDao(db);
  const observation = await dao.observationBySlot(ownerId, brandId, slotId);
  if (!observation) return null;
  const [citations, analyses] = await Promise.all([
    dao.citationsFor(observation.id),
    dao.analysesFor(observation.id),
  ]);
  return detailPayload(observation, citations, analyses);
}
