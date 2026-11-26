import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";
import { PromptDao } from "../prompts/dao.ts";
import {
  type AppendReferenceInput,
  type CompleteManualInput,
  type EvidenceError,
  type IngestAdoptedInput,
  type ReviseAnalysisInput,
  type SubmitManualInput,
  type UpdateCitationInput,
  canAppendReferenceLink,
  isNativeCitationOrigin,
  isReferenceLinkOrigin,
  qualifiesForC,
  resolveSamplingConditions,
} from "./contracts.ts";
import { EvidenceDao, type AnalysisRow, type CitationRow, type ObservationRow } from "./dao.ts";
import { invalidateEvidenceOverview } from "./overview-cache.ts";
import {
  analysisRuleVersion,
  citationPoolEligibility,
  classifyLabels,
  fingerprintAnswer,
  normalizeUrl,
  officialAttemptCapture,
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

function isUniqueViolation(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /unique|duplicate key/i.test(message);
}

async function replayAdoptedSlot(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  slotId: string,
) {
  const dao = new EvidenceDao(db);
  const prior = await dao.observationBySlot(ownerId, brandId, slotId);
  if (!prior || prior.evidenceState === "draft_evidence") return null;
  const [citations, analyses] = await Promise.all([
    dao.citationsFor(prior.id),
    dao.analysesFor(prior.id),
  ]);
  return { ...detailPayload(prior, citations, analyses), replayed: true as const };
}

async function owned(dao: EvidenceDao, ownerId: string, brandId: string) {
  const brand = await dao.lockBrand(brandId, ownerId);
  if (!brand) return denied("NOT_FOUND");
  if (brand.status !== "active" || brand.frozen === 1) return denied("NOT_ENTITLED");
  return brand;
}

const credentialPattern = /password|passwd|session[_-]?token|cookie|authorization/i;

function buildCitations(
  observationId: string,
  brandId: string,
  createdAt: string,
  citations: Array<{
    rawUrl: string;
    citationOrigin: CitationRow["citationOrigin"];
    positionLabel?: string | null;
    ownership?: CitationRow["ownership"];
    pageStatus?: CitationRow["pageStatus"];
  }>,
): CitationRow[] {
  const seen = new Set<string>();
  const rows: CitationRow[] = [];
  for (const item of citations) {
    const normalizedUrl = normalizeUrl(item.rawUrl);
    const key = `${item.citationOrigin}\n${normalizedUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: randomUUID(),
      observationId,
      brandId,
      rawUrl: item.rawUrl,
      normalizedUrl,
      citationOrigin: item.citationOrigin,
      positionLabel: item.positionLabel ?? null,
      ownership: item.ownership ?? "unknown",
      pageStatus: item.pageStatus ?? "unknown",
      createdAt,
    });
  }
  return rows;
}

function resolveManualWrite(input: SubmitManualInput | CompleteManualInput) {
  if (credentialPattern.test(`${input.answerText}\n${input.locatorRef ?? ""}`)) return denied("INVALID_INPUT");
  const missingAnswer = input.answerText.trim().length === 0;
  const missingCitation = input.citationSetState === "missing";
  const missingLocator = !input.locatorRef;
  const missingCollector = !input.collectorId;
  const incomplete = missingAnswer || missingCitation || missingLocator || missingCollector;
  const evidenceState = incomplete ? "draft_evidence" as const : input.contested ? "contested" as const : "complete" as const;
  const conditions = resolveSamplingConditions({
    region: input.region,
    targetRegion: input.targetRegion,
    observedRegion: input.observedRegion,
    newSession: input.newSession,
    productMode: input.productMode,
  });
  if (!conditions) return denied("INVALID_INPUT");
  const missingReason = incomplete
    ? [
      missingAnswer ? "answer-missing" : null,
      missingCitation ? "citation-fields-missing" : null,
      missingLocator ? "locator-missing" : null,
      missingCollector ? "collector-missing" : null,
    ].filter(Boolean).join(",")
    : null;
  return { evidenceState, conditions, missingReason };
}

function manualAnalysis(
  observationId: string,
  input: SubmitManualInput | CompleteManualInput,
  evidenceState: "complete" | "contested",
  labels: ReturnType<typeof classifyLabels>,
  now: string,
): AnalysisRow {
  return {
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
  };
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
        (item) => isNativeCitationOrigin(item.citationOrigin),
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
  let result: Awaited<ReturnType<typeof replayAdoptedSlot>> | Failure | (ReturnType<typeof detailPayload> & { replayed: boolean });
  try {
    result = await db.transaction(async (tx) => {
    const dao = new EvidenceDao(tx);
    const existing = await dao.operation(ownerId, input.operationId);
    if (existing) return JSON.parse(existing) as ReturnType<typeof detailPayload> & { replayed: true };

    const brand = await owned(dao, ownerId, input.brandId);
    if ("error" in brand) return brand;

    const adopted = await dao.adoptedAttempt(ownerId, input.brandId, input.slotId);
    if (!adopted?.rawText) return denied("NOT_FOUND");

    const prior = await dao.observationBySlot(ownerId, input.brandId, input.slotId);
    if (prior && prior.evidenceState !== "draft_evidence") {
      const [priorCitations, priorAnalyses] = await Promise.all([
        dao.citationsFor(prior.id),
        dao.analysesFor(prior.id),
      ]);
      return { ...detailPayload(prior, priorCitations, priorAnalyses), replayed: true as const };
    }

    const prompt = await new PromptDao(tx, input.brandId).version(adopted.promptSetId);
    const questionText = prompt?.content.questions.find((item) => item.id === adopted.questionId)?.text
      ?? adopted.questionId;

    const official = adopted.transport === "official_api";
    const captured = official ? officialAttemptCapture(adopted.receipt) : null;
    const conditions = resolveSamplingConditions(official ? {
      region: adopted.region,
      targetRegion: adopted.region,
      observedRegion: "unknown",
      newSession: "unknown",
      productMode: "unknown",
    } : {
      region: adopted.region,
      targetRegion: input.targetRegion,
      observedRegion: input.observedRegion,
      newSession: input.newSession,
      productMode: input.productMode,
    });
    if (!conditions) return denied("INVALID_INPUT");

    const now = clock();
    const observationId = randomUUID();
    const citationSetState = captured?.citationSetState
      ?? input.citationSetState
      ?? (input.citations ? "complete" : "missing");
    const citations = buildCitations(observationId, input.brandId, now, captured?.citations ?? input.citations ?? []);
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
      region: conditions.region,
      targetRegion: conditions.targetRegion,
      observedRegion: conditions.observedRegion,
      newSession: conditions.newSession,
      productMode: conditions.productMode,
      networkTrigger: captured?.networkTrigger ?? "unknown",
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
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    result = await replayAdoptedSlot(db, ownerId, input.brandId, input.slotId);
    if (!result) throw error;
  }
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

    const resolved = resolveManualWrite(input);
    if ("error" in resolved) return resolved;
    const { evidenceState, conditions, missingReason } = resolved;

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
      region: conditions.region,
      targetRegion: conditions.targetRegion,
      observedRegion: conditions.observedRegion,
      newSession: conditions.newSession,
      productMode: conditions.productMode,
      networkTrigger: "unknown",
      language: input.language,
      requestedNetworkMode: input.requestedNetworkMode,
      entityVersion: input.entityVersion,
      citationSetState: input.citationSetState,
      evidenceState,
      locatorRef: input.locatorRef ?? null,
      collectorId: input.collectorId ?? null,
      missingReason,
      createdAt: now,
    };

    const analyses: AnalysisRow[] = [];
    if (evidenceState === "complete" || evidenceState === "contested") {
      analyses.push(manualAnalysis(observationId, input, evidenceState, labels, now));
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

export async function completeManualEvidence(
  db: DatabaseConnection,
  ownerId: string,
  input: CompleteManualInput,
  clock: Clock = () => new Date().toISOString(),
  cache?: CacheStore,
) {
  const result = await db.transaction(async (tx) => {
    const dao = new EvidenceDao(tx);
    const existing = await dao.operation(ownerId, input.operationId);
    if (existing) return JSON.parse(existing) as ReturnType<typeof detailPayload> & { replayed: true };

    const brand = await owned(dao, ownerId, input.brandId);
    if ("error" in brand) return brand;

    const resolved = resolveManualWrite(input);
    if ("error" in resolved) return resolved;

    const current = await dao.observationForOwner(ownerId, input.observationId);
    if (!current || current.brandId !== input.brandId) return denied("NOT_FOUND");
    if (current.evidenceState !== "draft_evidence" || current.sourceMode !== "consumer_ui" || current.captureMethod !== "manual") {
      return denied("EVIDENCE_LOCKED");
    }

    const { evidenceState, conditions, missingReason } = resolved;
    const now = clock();
    const built = evidenceState === "draft_evidence" && input.citationSetState === "missing"
      ? []
      : buildCitations(current.id, input.brandId, now, input.citations);
    const existingCitations = await dao.citationsFor(current.id);
    const citations = [
      ...built,
      ...existingCitations.filter((item) => isReferenceLinkOrigin(item.citationOrigin) && !built.some(
        (next) => next.citationOrigin === item.citationOrigin && next.normalizedUrl === item.normalizedUrl,
      )),
    ];
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
      ...current,
      questionText: input.questionText,
      answerText: input.answerText,
      fingerprint: fingerprintAnswer(input.questionText, input.answerText),
      region: conditions.region,
      language: input.language,
      requestedNetworkMode: input.requestedNetworkMode,
      entityVersion: input.entityVersion,
      citationSetState: input.citationSetState,
      evidenceState,
      locatorRef: input.locatorRef ?? null,
      collectorId: input.collectorId ?? null,
      missingReason,
      targetRegion: conditions.targetRegion,
      observedRegion: conditions.observedRegion,
      newSession: conditions.newSession,
      productMode: conditions.productMode,
    };
    const updated = await dao.updateDraftObservation(observation);
    if (!updated) return denied("EVIDENCE_LOCKED");
    await dao.replaceCitations(current.id, input.brandId, citations);

    const analyses: AnalysisRow[] = [];
    if (evidenceState === "complete" || evidenceState === "contested") {
      analyses.push(manualAnalysis(current.id, input, evidenceState, labels, now));
    }
    for (const analysis of analyses) await dao.insertAnalysis(analysis);
    const payload = {
      ...detailPayload(observation, citations, analyses),
      replayed: false as const,
      incomplete: evidenceState === "draft_evidence",
    };
    await dao.recordOperation(ownerId, input.operationId, operationFingerprint(input), payload, now, input.brandId);
    if (evidenceState === "draft_evidence") return { ...payload, error: "EVIDENCE_INCOMPLETE" as const };
    return payload;
  });
  return releaseOverview(ownerId, input.brandId, result, cache);
}

export async function appendReferenceLink(
  db: DatabaseConnection,
  ownerId: string,
  input: AppendReferenceInput,
  clock: Clock = () => new Date().toISOString(),
  cache?: CacheStore,
) {
  let result: Failure | (ReturnType<typeof detailPayload> & { replayed: boolean; deduped: boolean });
  try {
    result = await db.transaction(async (tx) => {
      const dao = new EvidenceDao(tx);
      const existing = await dao.operation(ownerId, input.operationId);
      if (existing) {
        const stored = JSON.parse(existing) as ReturnType<typeof detailPayload> & { deduped: boolean };
        return { ...stored, replayed: true as const };
      }

      const brand = await owned(dao, ownerId, input.brandId);
      if ("error" in brand) return brand;

      const observation = await dao.lockObservation(ownerId, input.observationId);
      if (!observation || observation.brandId !== input.brandId) return denied("NOT_FOUND");
      if (!canAppendReferenceLink(observation.evidenceState)) return denied("INVALID_INPUT");

      let url: URL;
      try {
        url = new URL(input.rawUrl);
      } catch {
        return denied("INVALID_INPUT");
      }
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
        return denied("INVALID_INPUT");
      }

      const now = clock();
      const current = await dao.citationsFor(observation.id);
      const normalizedUrl = normalizeUrl(url.toString());
      const duplicate = current.some((item) => item.citationOrigin === input.citationOrigin && item.normalizedUrl === normalizedUrl);
      const row: CitationRow = {
        id: randomUUID(),
        observationId: observation.id,
        brandId: input.brandId,
        rawUrl: url.toString(),
        normalizedUrl,
        citationOrigin: input.citationOrigin,
        positionLabel: null,
        ownership: "unknown",
        pageStatus: "unknown",
        createdAt: now,
      };
      if (!duplicate) await dao.insertCitations([row]);
      const citations = duplicate ? current : [...current, row];
      const analyses = await dao.analysesFor(observation.id);
      const payload = {
        ...detailPayload(observation, citations, analyses),
        replayed: false as const,
        deduped: duplicate,
      };
      await dao.recordOperation(ownerId, input.operationId, operationFingerprint(input), payload, now, input.brandId);
      return payload;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await new EvidenceDao(db).operation(ownerId, input.operationId);
    if (!existing) throw error;
    const stored = JSON.parse(existing) as ReturnType<typeof detailPayload> & { deduped: boolean };
    result = { ...stored, replayed: true };
  }
  return releaseOverview(ownerId, input.brandId, result, cache);
}

function citationUpdateFingerprint(input: UpdateCitationInput) {
  return operationFingerprint({
    action: input.action,
    brandId: input.brandId,
    observationId: input.observationId,
    citationId: input.citationId,
    ownership: input.ownership,
    pageStatus: input.pageStatus,
  });
}

export async function updateCitationOwnership(
  db: DatabaseConnection,
  actorId: string,
  input: UpdateCitationInput,
  clock: Clock = () => new Date().toISOString(),
  cache?: CacheStore,
) {
  const operationKey = `update-citation:${input.operationId}`;
  const fingerprint = citationUpdateFingerprint(input);
  function replay(storedFingerprint: string) {
    if (storedFingerprint !== fingerprint) return denied("OPERATION_CONFLICT");
    return {
      citation: { id: input.citationId, ownership: input.ownership, pageStatus: input.pageStatus },
      replayed: true as const,
    };
  }

  let outcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const access = await authorizeBrandActor(tx, actorId, input.brandId, "write", clock());
      if (!access) return denied("NOT_FOUND");

      const dao = new EvidenceDao(tx);
      const existing = await dao.operationRecord(actorId, operationKey);
      if (existing) return replay(existing.fingerprint);

      const observation = await dao.lockObservation(access.ownerId, input.observationId);
      if (!observation || observation.brandId !== input.brandId) return denied("NOT_FOUND");

      const citation = await dao.updateNativeCitationStatus({
        id: input.citationId,
        observationId: observation.id,
        brandId: input.brandId,
        ownership: input.ownership,
        pageStatus: input.pageStatus,
      });
      if (!citation) {
        const exists = await dao.citationExists(observation.id, input.brandId, input.citationId);
        return denied(exists ? "INVALID_INPUT" : "NOT_FOUND");
      }

      const now = clock();
      await dao.recordOperation(actorId, operationKey, fingerprint, null, now, input.brandId);
      await dao.recordCitationRevision(access.ownerId, input.brandId, randomUUID(), now);
      return { citation, replayed: false as const, ownerId: access.ownerId };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    if (!await authorizeBrandActor(db, actorId, input.brandId, "write", clock())) return denied("NOT_FOUND");
    const existing = await new EvidenceDao(db).operationRecord(actorId, operationKey);
    if (!existing) throw error;
    return replay(existing.fingerprint);
  }
  if (!("ownerId" in outcome)) return outcome;
  await invalidateEvidenceOverview(outcome.ownerId, input.brandId, cache ?? openCache());
  return { citation: outcome.citation, replayed: outcome.replayed };
}

export async function readManualEvidenceContext(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
) {
  const adopted = await authorizeBrandActor(db, ownerId, brandId, "read");
  if (!adopted) return null;
  ownerId = adopted.ownerId;
  const brand = await new BrandDao(db).version(ownerId, brandId);
  if (!brand || brand.status !== "active") return null;
  const source = await new PromptDao(db, brandId).latestClusterSource();
  return {
    brandId: brand.id,
    brandName: brand.fields.name,
    aliases: brand.fields.aliases,
    officialWebsite: brand.fields.website || null,
    entityVersion: brand.entityVersion,
    region: brand.fields.region,
    language: brand.fields.language,
    questions: (source?.questions ?? [])
      .filter((item) => item.text.trim().length > 0)
      .slice(0, 30)
      .map((item) => ({ id: item.id, text: item.text })),
  };
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
  const identity = await dao.observationIdentity(observationId);
  if (!identity) return null;
  const adopted = await authorizeBrandActor(db, ownerId, identity.brandId, "read");
  if (!adopted || adopted.role === "read_only" || adopted.ownerId !== identity.ownerId) return null;
  ownerId = adopted.ownerId;
  const observation = await dao.observationForOwner(ownerId, observationId);
  if (!observation) return null;
  const [citations, analyses, drafts, cost] = await Promise.all([
    dao.citationsFor(observation.id),
    dao.analysesFor(observation.id),
    dao.openAnalysisDrafts(ownerId, observation.id),
    observation.attemptId ? dao.attemptCost(ownerId, observation.attemptId) : Promise.resolve(null),
  ]);
  const known = cost?.costState === "known" && cost.actualMinor !== null && cost.currency;
  return {
    ...detailPayload(observation, citations, analyses),
    drafts,
    capture: {
      costState: cost?.costState ?? "none",
      actualMinor: known ? cost.actualMinor : null,
      currency: known ? cost.currency : null,
    },
  };
}

export async function readObservationBySlot(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  slotId: string,
) {
  const adopted = await authorizeBrandActor(db, ownerId, brandId, "read");
  if (!adopted || adopted.role === "read_only") return null;
  ownerId = adopted.ownerId;
  const dao = new EvidenceDao(db);
  const observation = await dao.observationBySlot(ownerId, brandId, slotId);
  if (!observation) return null;
  const [citations, analyses] = await Promise.all([
    dao.citationsFor(observation.id),
    dao.analysesFor(observation.id),
  ]);
  return detailPayload(observation, citations, analyses);
}
