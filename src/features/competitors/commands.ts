import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection, QueryConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import {
  competitorShareBreakdown,
  orderedRankBreakdown,
  type MentionState,
} from "../competitor-share/rules.ts";
import { ContentDao } from "../content/dao.ts";
import { coverageFromCluster } from "../content/rules.ts";
import { invalidateEvidenceOverview } from "../evidence/overview-cache.ts";
import { OptimizationDao } from "../optimization/dao.ts";
import { assertsNoCausalClaim, normalizeTargetPage, priorityBucketOf } from "../optimization/rules.ts";
import {
  citationSourceReference,
  inspectCopiedBrief,
  inspectSource,
  matchOwnFactVersions,
  supportedClaimRecord,
  thirdPartySupportSummary,
} from "../source-opportunities/rules.ts";
import { isNativeCitationOrigin } from "../evidence/contracts.ts";
import { authorizeBrandActor, type BrandScope } from "../team-access/brand-scope.ts";
import type {
  BriefStatusInput,
  CompetitorError,
  InspectCitationInput,
  ProposeBriefInput,
  RecordMentionsInput,
  ResearchHandoffInput,
  SaveCompetitorSetInput,
} from "./contracts.ts";
import { normalizeCompetitorLabels } from "./contracts.ts";
import {
  CompetitorDao,
  type CitationSourceRow,
  type CompetitorMentionDetailRow,
  type CompetitorSetRow,
  type ResearchBriefRow,
} from "./dao.ts";

type Clock = () => string;
type Failure = { error: CompetitorError };

function denied(error: CompetitorError): Failure {
  return { error };
}

async function authorizeCompetitorRead(
  db: QueryConnection,
  actorId: string,
  brandId: string,
  now: string,
): Promise<BrandScope | Failure> {
  if (!brandIdSchema.safeParse(brandId).success) return denied("NOT_FOUND");
  const access = await authorizeBrandActor(db, actorId, brandId, "read", now);
  return access ?? denied("NOT_FOUND");
}

async function authorizeCompetitorWrite(
  db: QueryConnection,
  actorId: string,
  brandId: string,
  now: string,
): Promise<BrandScope | Failure> {
  if (!brandIdSchema.safeParse(brandId).success) return denied("NOT_FOUND");
  const access = await authorizeBrandActor(db, actorId, brandId, "write", now);
  if (access) return access;
  const read = await authorizeBrandActor(db, actorId, brandId, "read", now);
  return denied(read ? "FORBIDDEN" : "NOT_FOUND");
}

export function labelsOf(row: CompetitorSetRow) {
  return normalizeCompetitorLabels(JSON.parse(row.labelsJson) as string[]) ?? [];
}

function emptyShare(labels: readonly string[]) {
  return {
    ...competitorShareBreakdown([], []),
    rank: {
      ...orderedRankBreakdown(labels, []),
      unorderedCount: 0,
    },
  };
}

export function shareFromMentions(
  labels: readonly string[],
  mentions: readonly (Pick<CompetitorMentionDetailRow, "observationId" | "competitorLabel" | "ordered" | "position"> & {
    mentionState?: MentionState;
    questionId?: string | null;
    questionText?: string | null;
  })[],
) {
  const breakdown = competitorShareBreakdown(
    labels,
    mentions.map((mention) => ({
      observationId: mention.observationId,
      questionId: mention.questionId ?? null,
      questionText: mention.questionText ?? null,
      brandId: mention.competitorLabel,
      mentionState: mention.mentionState ?? "true",
    })),
  );
  const activeMentions = mentions.filter((mention) => (mention.mentionState ?? "true") === "true");
  const unorderedCount = activeMentions.filter((mention) => mention.ordered === 0).length;
  const orderedStats = orderedRankBreakdown(
    labels,
    mentions.map((mention) => ({
      observationId: mention.observationId,
      questionId: mention.questionId ?? null,
      questionText: mention.questionText ?? null,
      brandId: mention.competitorLabel,
      mentionState: mention.mentionState ?? "true",
      ordered: mention.ordered,
      position: mention.position,
    })),
  );
  return {
    ...breakdown,
    rank: {
      ...orderedStats,
      unorderedCount,
    },
  };
}

export async function saveCompetitorSet(
  db: DatabaseConnection,
  actorId: string,
  input: SaveCompetitorSetInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return db.transaction(async (tx) => {
    const now = clock();
    const access = await authorizeCompetitorWrite(tx, actorId, input.brandId, now);
    if ("error" in access) return access;
    const labels = normalizeCompetitorLabels(input.labels);
    if (!labels) return denied("INVALID_INPUT");
    const labelsJson = JSON.stringify(labels);
    const ownerId = access.ownerId;
    const dao = new CompetitorDao(tx);
    const existing = await dao.listSets(ownerId, input.brandId);
    const latest = existing.at(-1);
    if (latest && latest.labelsJson === labelsJson) {
      return { set: { ...latest, labels }, created: false as const };
    }
    const row: CompetitorSetRow = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId,
      version: (latest?.version ?? 0) + 1,
      labelsJson,
      createdAt: now,
    };
    await dao.insertSet(row);
    return { set: { ...row, labels }, created: true as const };
  });
}

export async function recordCompetitorMentions(
  db: DatabaseConnection,
  actorId: string,
  input: RecordMentionsInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return db.transaction(async (tx) => {
    const now = clock();
    const access = await authorizeCompetitorWrite(tx, actorId, input.brandId, now);
    if ("error" in access) return access;
    const ownerId = access.ownerId;
    const dao = new CompetitorDao(tx);
    const sets = await dao.listSets(ownerId, input.brandId);
    const set = sets.find((item) => item.id === input.setId);
    if (!set) return denied("NOT_FOUND");
    if (!await dao.observationOwned(ownerId, input.brandId, input.observationId)) return denied("NOT_FOUND");
    const setLabels = labelsOf(set);
    const allowed = new Set(setLabels);
    if (input.mentions.some((mention) => !allowed.has(mention.label))) return denied("INVALID_INPUT");
    const orderedBit = input.ordered ? (1 as const) : (0 as const);
    const entries = input.mentions.length === 0
      ? setLabels.map((label) => ({
        label,
        mentionState: "false" as const,
        ordered: orderedBit,
        position: null,
      }))
      : input.mentions.map((mention) => {
        const mentionState = mention.state ?? "true";
        const position = orderedBit === 1 && mentionState === "true" ? mention.position ?? null : null;
        return { label: mention.label, mentionState, ordered: orderedBit, position };
      });
    const existingRows = await dao.listObservationMentions(input.setId, input.observationId);
    if (existingRows.length > 0) {
      const obsOrdered = existingRows.some((row) => row.ordered === 1);
      if (obsOrdered !== input.ordered) {
        return denied("OPERATION_CONFLICT");
      }
    }
    const existingByLabel = new Map(existingRows.map((row) => [row.competitorLabel, row]));
    for (const entry of entries) {
      const existing = existingByLabel.get(entry.label);
      if (existing) {
        if (
          existing.mentionState !== entry.mentionState
          || existing.ordered !== entry.ordered
          || existing.position !== entry.position
        ) {
          return denied("OPERATION_CONFLICT");
        }
        continue;
      }
      await dao.insertMention({
        id: randomUUID(),
        brandId: input.brandId,
        ownerId,
        setId: input.setId,
        observationId: input.observationId,
        competitorLabel: entry.label,
        mentionState: entry.mentionState,
        ordered: entry.ordered,
        position: entry.position,
        createdAt: now,
      });
    }
    return { recorded: entries.length };
  });
}

export async function readCompetitorShare(
  db: DatabaseConnection,
  actorId: string,
  brandId: string,
  version?: number,
) {
  const access = await authorizeCompetitorRead(db, actorId, brandId, new Date().toISOString());
  if ("error" in access) return access;
  const ownerId = access.ownerId;
  const dao = new CompetitorDao(db);
  const sets = await dao.listSets(ownerId, brandId);
  const selected = version === undefined ? sets.at(-1) ?? null : sets.find((item) => item.version === version) ?? null;
  if (version !== undefined && !selected) return denied("NOT_FOUND");
  if (!selected) {
    return {
      sets: [],
      selected: null,
      ...emptyShare([]),
      truncated: false,
    };
  }
  const mentions = await dao.listMentions(ownerId, brandId, selected.id);
  const labels = labelsOf(selected);
  if (mentions.truncated) {
    return {
      sets: sets.map((item) => ({ id: item.id, version: item.version, labels: labelsOf(item), createdAt: item.createdAt })),
      selected: { id: selected.id, version: selected.version, labels, createdAt: selected.createdAt },
      ...emptyShare(labels),
      truncated: true,
    };
  }
  const share = shareFromMentions(labels, mentions.rows);
  return {
    sets: sets.map((item) => ({ id: item.id, version: item.version, labels: labelsOf(item), createdAt: item.createdAt })),
    selected: { id: selected.id, version: selected.version, labels, createdAt: selected.createdAt },
    ...share,
    truncated: false,
  };
}

function bit(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function presentCitation(row: CitationSourceRow) {
  return {
    citationId: row.citationId,
    observationId: row.observationId,
    rawUrl: row.rawUrl,
    normalizedUrl: row.normalizedUrl,
    citationOrigin: row.citationOrigin,
    ownership: row.ownership,
    pageStatus: row.pageStatus,
    state: row.state ?? "observed" as const,
    support: row.support ?? "unknown" as const,
    supportedClaim: row.supportedClaim,
    factVersionId: row.factVersionId,
    recorded: row.state !== null,
  };
}

function claimText(content: string) {
  try {
    const parsed = z.object({ claim: z.string() }).safeParse(JSON.parse(content));
    const claim = parsed.success ? parsed.data.claim.trim() : "";
    return claim.length > 0 ? claim : null;
  } catch {
    return null;
  }
}

function usableFactsOf(rows: readonly { id: string; content: string }[]) {
  return rows.flatMap((row) => {
    const claim = claimText(row.content);
    return claim ? [{ id: row.id, claim }] : [];
  });
}

export function citationHosts(rows: readonly { normalizedUrl: string }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    let host = "unknown";
    try {
      host = new URL(row.normalizedUrl).hostname;
    } catch {
      host = "unknown";
    }
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([host, pages]) => ({ host, pages }))
    .sort((left, right) => (left.host < right.host ? -1 : left.host > right.host ? 1 : 0));
}

export async function inspectCitationSource(
  db: DatabaseConnection,
  actorId: string,
  input: InspectCitationInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const judged = inspectSource(input);
  return db.transaction(async (tx) => {
    const now = clock();
    const access = await authorizeCompetitorWrite(tx, actorId, input.brandId, now);
    if ("error" in access) return access;
    const ownerId = access.ownerId;
    const dao = new CompetitorDao(tx);
    if (!await dao.citationOwned(ownerId, input.brandId, input.citationId)) return denied("NOT_FOUND");
    let factClaim: string | null = null;
    if (judged.support === "supports" && input.factVersionId) {
      const fact = await dao.approvedFact(ownerId, input.brandId, input.factVersionId);
      factClaim = fact ? claimText(fact.content) : null;
      if (!factClaim) return denied("INVALID_INPUT");
    }
    const recorded = supportedClaimRecord({
      support: judged.support,
      supportedClaim: input.supportedClaim,
      factVersionId: judged.support === "supports" ? input.factVersionId ?? null : null,
      factClaim,
    });
    const existing = await dao.findInspection(input.citationId);
    const row = {
      id: existing?.id ?? randomUUID(),
      brandId: input.brandId,
      ownerId,
      citationId: input.citationId,
      state: judged.state,
      support: judged.support,
      pageLive: bit(input.pageLive),
      readable: bit(input.readable),
      authorKnown: bit(input.authorKnown),
      supportsBrand: bit(input.supportsBrand),
      supportedClaim: recorded.supportedClaim,
      factVersionId: recorded.factVersionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) await dao.updateInspection(row);
    else await dao.insertInspection(row);
    const [citation] = await queryCitation(tx, ownerId, input.brandId, input.citationId);
    return {
      inspection: row,
      citationKept: judged.citationKept && Boolean(citation),
      support: judged.support,
      state: judged.state,
    };
  });
}

async function queryCitation(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  citationId: string,
) {
  const dao = new CompetitorDao(db);
  const listed = await dao.listCitationSources(ownerId, brandId);
  return listed.rows.filter((row) => row.citationId === citationId);
}

export async function readCitationSources(db: DatabaseConnection, actorId: string, brandId: string) {
  const access = await authorizeCompetitorRead(db, actorId, brandId, new Date().toISOString());
  if ("error" in access) return access;
  const dao = new CompetitorDao(db);
  const listed = await dao.listCitationSources(access.ownerId, brandId);
  const allCitations = listed.rows.map(presentCitation);
  const supportSummary = listed.truncated ? thirdPartySupportSummary([]) : thirdPartySupportSummary(allCitations.filter((item) => isNativeCitationOrigin(item.citationOrigin)));
  const restricted = access.role === "read_only";
  return {
    citations: restricted ? [] : allCitations,
    hosts: restricted ? [] : citationHosts(allCitations),
    supportSummary,
    citationCount: listed.truncated ? 0 : allCitations.length,
    truncated: listed.truncated,
  };
}

export async function proposeResearchBrief(
  db: DatabaseConnection,
  actorId: string,
  input: ProposeBriefInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const judged = inspectCopiedBrief({
    sourceText: input.sourceText,
    briefText: input.briefText,
    sourceBrand: input.sourceBrand,
    ownBrand: input.ownBrand,
    gap: input.gap,
    sourceIds: input.sourceIds,
  });
  if (!judged.accepted) return { error: "INVALID_INPUT" as const, reason: judged.reason };
  const sourceIds = [...new Set(input.sourceIds)];
  return db.transaction(async (tx) => {
    const now = clock();
    const access = await authorizeCompetitorWrite(tx, actorId, input.brandId, now);
    if ("error" in access) return access;
    const ownerId = access.ownerId;
    const dao = new CompetitorDao(tx);
    const ownedIds = await dao.citationIdsOwned(ownerId, input.brandId, sourceIds);
    if (ownedIds.length !== sourceIds.length) return { error: "INVALID_INPUT" as const, reason: "missing_evidence" as const };
    const row = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId,
      questionCluster: input.questionCluster,
      gap: input.gap,
      factsJson: JSON.stringify(input.facts),
      sourceIdsJson: JSON.stringify(sourceIds),
      status: "proposed" as const,
      createdAt: now,
      updatedAt: now,
    };
    await dao.insertBrief(row);
    return { brief: { ...row, copiedReplacement: false as const, facts: [...input.facts], sourceIds } };
  });
}

export async function setResearchBriefStatus(
  db: DatabaseConnection,
  actorId: string,
  input: BriefStatusInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return db.transaction(async (tx) => {
    const now = clock();
    const access = await authorizeCompetitorWrite(tx, actorId, input.brandId, now);
    if ("error" in access) return access;
    const dao = new CompetitorDao(tx);
    const updated = await dao.updateBriefStatus(access.ownerId, input.brandId, input.briefId, input.status, now);
    if (!updated) return denied("OPERATION_CONFLICT");
    return { id: input.briefId, status: input.status };
  });
}

export async function readResearchBriefs(db: DatabaseConnection, actorId: string, brandId: string) {
  const access = await authorizeCompetitorRead(db, actorId, brandId, new Date().toISOString());
  if ("error" in access) return access;
  const dao = new CompetitorDao(db);
  const rows = await dao.listBriefs(access.ownerId, brandId);
  return {
    briefs: rows.map((row) => ({
      ...row,
      facts: zFacts(row.factsJson),
      sourceIds: zFacts(row.sourceIdsJson),
      copiedReplacement: false as const,
    })),
  };
}

function zFacts(json: string) {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

export async function readCompetitorWorkspace(
  db: DatabaseConnection,
  actorId: string,
  brandId: string,
  version?: number,
) {
  const access = await authorizeCompetitorRead(db, actorId, brandId, new Date().toISOString());
  if ("error" in access) return access;
  const ownerId = access.ownerId;
  const isReadOnly = access.role === "read_only";
  const dao = new CompetitorDao(db);
  const sets = await dao.listSets(ownerId, brandId);
  const selected = version === undefined ? sets.at(-1) ?? null : sets.find((item) => item.version === version) ?? null;
  if (version !== undefined && !selected) return denied("NOT_FOUND");
  const [mentions, observations, sources, briefs, approvedFacts] = await Promise.all([
    selected ? dao.listMentions(ownerId, brandId, selected.id) : Promise.resolve({ truncated: false as const, rows: [] }),
    isReadOnly ? Promise.resolve([]) : dao.listRecentObservations(ownerId, brandId),
    dao.listCitationSources(ownerId, brandId),
    dao.listBriefs(ownerId, brandId),
    isReadOnly ? Promise.resolve([]) : dao.listApprovedFacts(ownerId, brandId),
  ]);
  const labels = selected ? labelsOf(selected) : [];
  const share = selected && !mentions.truncated
    ? shareFromMentions(labels, mentions.rows)
    : emptyShare(labels);
  const allCitations = sources.rows.map(presentCitation);
  const supportSummary = sources.truncated ? thirdPartySupportSummary([]) : thirdPartySupportSummary(allCitations.filter((item) => isNativeCitationOrigin(item.citationOrigin)));
  return {
    role: access.role,
    sets: sets.map((item) => ({ id: item.id, version: item.version, labels: labelsOf(item), createdAt: item.createdAt })),
    selected: selected ? { id: selected.id, version: selected.version, labels, createdAt: selected.createdAt } : null,
    ...share,
    truncated: mentions.truncated,
    observations: isReadOnly ? [] : observations,
    citations: isReadOnly ? [] : allCitations,
    hosts: isReadOnly ? [] : citationHosts(sources.rows),
    citationCount: sources.truncated ? 0 : allCitations.length,
    supportSummary,
    sourcesTruncated: sources.truncated,
    briefs: briefs.map((row) => ({
      id: row.id,
      questionCluster: row.questionCluster,
      gap: row.gap,
      status: row.status,
      facts: zFacts(row.factsJson),
      sourceIds: zFacts(row.sourceIdsJson),
      contentBriefId: row.contentBriefId,
      optimizationTaskId: row.optimizationTaskId,
      copiedReplacement: false as const,
    })),
    usableFacts: isReadOnly ? [] : usableFactsOf(approvedFacts),
  };
}

async function ensureContentPlan(
  tx: TransactionConnection,
  ownerId: string,
  brandId: string,
  questionCluster: string,
  now: string,
) {
  const content = new ContentDao(tx);
  const existing = await content.getPlanByCluster(ownerId, brandId, questionCluster);
  if (existing) return existing.id;
  const planId = randomUUID();
  const coverageJson = JSON.stringify(coverageFromCluster({
    questionCluster,
    existingPages: [],
    pendingPages: [],
    gapPages: ["planned"],
  }));
  try {
    await tx.savepoint(async (nested) => {
      await new ContentDao(nested).insertPlan({
        id: planId, brandId, ownerId, questionCluster, coverageJson, createdAt: now, updatedAt: now,
      });
    });
    return planId;
  } catch {
    const again = await content.getPlanByCluster(ownerId, brandId, questionCluster);
    if (!again) throw new Error("content plan was not created");
    return again.id;
  }
}

function parsedFactIds(json: string) {
  try {
    return zFacts(json);
  } catch {
    return [];
  }
}

async function loadAcceptedBrief(
  tx: TransactionConnection,
  actorId: string,
  input: ResearchHandoffInput,
  now: string,
) {
  const access = await authorizeCompetitorWrite(tx, actorId, input.brandId, now);
  if ("error" in access) return access;
  const ownerId = access.ownerId;
  const dao = new CompetitorDao(tx);
  const brief = await dao.lockBrief(ownerId, input.brandId, input.briefId);
  if (!brief) return denied("NOT_FOUND");
  if (brief.status !== "accepted") return denied("OPERATION_CONFLICT");
  return { dao, brief, ownerId };
}

export async function createContentBriefFromResearch(
  db: DatabaseConnection,
  actorId: string,
  input: ResearchHandoffInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return db.transaction(async (tx) => {
    const now = clock();
    const loaded = await loadAcceptedBrief(tx, actorId, input, now);
    if ("error" in loaded) return loaded;
    const { dao, brief, ownerId } = loaded;
    const content = new ContentDao(tx);
    if (brief.contentBriefId) {
      const existing = await content.getBrief(ownerId, input.brandId, brief.contentBriefId);
      if (existing) return await contentHandoffResult(content, existing.id, existing.status, false, brief);
    }
    const facts = usableFactsOf(await dao.listApprovedFacts(ownerId, input.brandId));
    const factVersionIds = matchOwnFactVersions(zFacts(brief.factsJson), facts);
    const competitorSource = citationSourceReference(
      await dao.citationUrls(ownerId, input.brandId, zFacts(brief.sourceIdsJson)),
    );
    const planId = await ensureContentPlan(tx, ownerId, input.brandId, brief.questionCluster, now);
    const briefId = randomUUID();
    await content.insertBrief({
      id: briefId,
      brandId: input.brandId,
      ownerId,
      planId,
      optimizationTaskId: null,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    await content.insertBriefVersion({
      id: randomUUID(),
      briefId,
      brandId: input.brandId,
      revision: 1,
      audience: "",
      targetGap: brief.gap,
      applicableBoundary: "",
      primaryPage: "",
      conversionAction: "",
      templateKind: competitorSource ? "verifiable_comparison" : "fact_faq",
      titleCandidatesJson: "[]",
      factVersionIdsJson: JSON.stringify(factVersionIds),
      competitorSource,
      confirmedAt: null,
      createdAt: now,
    });
    const attached = await dao.attachHandoff(ownerId, input.brandId, brief.id, "content_brief_id", briefId, now);
    if (!attached) {
      await content.deleteDraftBrief(ownerId, input.brandId, briefId);
      const current = await dao.lockBrief(ownerId, input.brandId, brief.id);
      if (!current?.contentBriefId) return denied("OPERATION_CONFLICT");
      const winner = await content.getBrief(ownerId, input.brandId, current.contentBriefId);
      if (!winner) return denied("OPERATION_CONFLICT");
      return await contentHandoffResult(content, winner.id, winner.status, false, current);
    }
    return {
      contentBriefId: briefId,
      created: true as const,
      status: "draft" as const,
      questionCluster: brief.questionCluster,
      targetGap: brief.gap,
      competitorSource,
      factVersionIds,
    };
  });
}

async function contentHandoffResult(
  content: ContentDao,
  contentBriefId: string,
  status: "draft" | "confirmed" | "invalidated",
  created: boolean,
  brief: ResearchBriefRow,
) {
  const version = await content.latestBriefVersion(contentBriefId);
  return {
    contentBriefId,
    created,
    status,
    questionCluster: brief.questionCluster,
    targetGap: version?.targetGap ?? brief.gap,
    competitorSource: version?.competitorSource ?? null,
    factVersionIds: version ? parsedFactIds(version.factVersionIdsJson) : [],
  };
}

export async function createOptimizationTaskFromResearch(
  db: DatabaseConnection,
  actorId: string,
  input: ResearchHandoffInput,
  clock: Clock = () => new Date().toISOString(),
  cache?: CacheStore,
) {
  let brandOwnerId = "";
  const created = await db.transaction(async (tx) => {
    const now = clock();
    const loaded = await loadAcceptedBrief(tx, actorId, input, now);
    if ("error" in loaded) return loaded;
    const { dao, brief, ownerId } = loaded;
    brandOwnerId = ownerId;
    const tasks = new OptimizationDao(tx);
    if (brief.optimizationTaskId) {
      const existing = await tasks.getTask(ownerId, input.brandId, brief.optimizationTaskId);
      if (existing) {
        return { taskId: existing.id, created: false as const, merged: false as const, questionCluster: brief.questionCluster };
      }
    }
    const urls = await dao.citationUrls(ownerId, input.brandId, zFacts(brief.sourceIdsJson));
    const reference = citationSourceReference(urls);
    const prose = `${brief.gap}\n${reference ?? ""}`;
    if (!assertsNoCausalClaim(prose)) return denied("INVALID_INPUT");
    const targetPage = normalizeTargetPage(urls[0]);
    const open = await tasks.findOpenTask({
      ownerId,
      brandId: input.brandId,
      questionCluster: brief.questionCluster,
      targetPage,
      gapType: "citation_gap",
    });
    if (open) {
      const attached = await dao.attachHandoff(ownerId, input.brandId, brief.id, "optimization_task_id", open.id, now);
      const taskId = attached ? open.id : (await dao.lockBrief(ownerId, input.brandId, brief.id))?.optimizationTaskId;
      if (!taskId) return denied("OPERATION_CONFLICT");
      return { taskId, created: false as const, merged: true as const, questionCluster: brief.questionCluster };
    }
    const findingId = randomUUID();
    const taskId = randomUUID();
    const draft = {
      gapType: "citation_gap" as const,
      privacyRisk: 0 as const,
      assumptionLevel: "pending" as const,
    };
    try {
      await tx.savepoint(async (nested) => {
        const writer = new OptimizationDao(nested);
        await writer.insertFinding({
          id: findingId,
          brandId: input.brandId,
          ownerId,
          gapType: draft.gapType,
          questionCluster: brief.questionCluster,
          targetPage,
          observationId: null,
          analysisVersionId: null,
          evidenceSummary: reference ? `研究 Brief 记录的来源引用：${reference}` : "研究 Brief 没有仍可回读的来源 URL。",
          problemStatement: brief.gap,
          hypothesis: "这是议题缺口，不把他人页面改写成自家品牌文案。",
          assumptionLevel: draft.assumptionLevel,
          stepsJson: JSON.stringify([
            "核对来源引用仍属于本品牌",
            "把已批准事实绑定到内容草稿",
            "确认内容 Brief 后再起草，不直接发布",
          ]),
          completionCriteria: "内容 Brief 仍为草稿，并绑定本品牌已批准事实后才可确认。",
          retestMethod: "确认发布后按同一问题簇复测，不把来源引用当成已发布效果。",
          businessImportance: 2,
          estimatedEffort: 2,
          verifiedEvidence: reference ? 1 : 0,
          privacyRisk: draft.privacyRisk,
          createdAt: now,
        });
        await writer.insertTask({
          id: taskId,
          brandId: input.brandId,
          ownerId,
          primaryFindingId: findingId,
          gapType: draft.gapType,
          questionCluster: brief.questionCluster,
          targetPage,
          title: brief.gap.slice(0, 80),
          status: "todo",
          priorityBucket: priorityBucketOf(draft),
          manualRank: null,
          reorderReason: null,
          completionNote: null,
          dismissReason: null,
          retestConclusion: null,
          createdAt: now,
          updatedAt: now,
        });
        await writer.linkEvidence(taskId, findingId, input.brandId, now);
      });
    } catch {
      const raced = await tasks.findOpenTask({
        ownerId,
        brandId: input.brandId,
        questionCluster: brief.questionCluster,
        targetPage,
        gapType: "citation_gap",
      });
      if (!raced) throw new Error("optimization task was not created");
      const attached = await dao.attachHandoff(
        ownerId, input.brandId, brief.id, "optimization_task_id", raced.id, now,
      );
      const taskIdWinner = attached ? raced.id : (await dao.lockBrief(ownerId, input.brandId, brief.id))?.optimizationTaskId;
      if (!taskIdWinner) return denied("OPERATION_CONFLICT");
      return { taskId: taskIdWinner, created: false as const, merged: true as const, questionCluster: brief.questionCluster };
    }
    const attached = await dao.attachHandoff(ownerId, input.brandId, brief.id, "optimization_task_id", taskId, now);
    if (!attached) {
      await tasks.deleteTaskGraph(ownerId, input.brandId, taskId, findingId);
      const current = await dao.lockBrief(ownerId, input.brandId, brief.id);
      if (!current?.optimizationTaskId) return denied("OPERATION_CONFLICT");
      return { taskId: current.optimizationTaskId, created: false as const, merged: true as const, questionCluster: brief.questionCluster };
    }
    return { taskId, created: true as const, merged: false as const, questionCluster: brief.questionCluster };
  });
  if (!("error" in created) && brandOwnerId) {
    await invalidateEvidenceOverview(brandOwnerId, input.brandId, cache ?? openCache());
  }
  return created;
}
