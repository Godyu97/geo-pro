import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import {
  competitorShareBreakdown,
  orderedRankBreakdown,
  type MentionState,
} from "../competitor-share/rules.ts";
import { inspectCopiedBrief, inspectSource } from "../source-opportunities/rules.ts";
import type {
  BriefStatusInput,
  CompetitorError,
  InspectCitationInput,
  ProposeBriefInput,
  RecordMentionsInput,
  SaveCompetitorSetInput,
} from "./contracts.ts";
import { normalizeCompetitorLabels } from "./contracts.ts";
import { CompetitorDao, type CitationSourceRow, type CompetitorMentionDetailRow, type CompetitorSetRow } from "./dao.ts";

type Clock = () => string;
type Failure = { error: CompetitorError };

function denied(error: CompetitorError): Failure {
  return { error };
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
  ownerId: string,
  input: SaveCompetitorSetInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const labels = normalizeCompetitorLabels(input.labels);
  if (!labels) return denied("INVALID_INPUT");
  const labelsJson = JSON.stringify(labels);
  return db.transaction(async (tx) => {
    const dao = new CompetitorDao(tx);
    if (!await dao.ownedBrand(ownerId, input.brandId)) return denied("NOT_FOUND");
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
      createdAt: clock(),
    };
    await dao.insertSet(row);
    return { set: { ...row, labels }, created: true as const };
  });
}

export async function recordCompetitorMentions(
  db: DatabaseConnection,
  ownerId: string,
  input: RecordMentionsInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return db.transaction(async (tx) => {
    const dao = new CompetitorDao(tx);
    if (!await dao.ownedBrand(ownerId, input.brandId)) return denied("NOT_FOUND");
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
    const now = clock();
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
  ownerId: string,
  brandId: string,
  version?: number,
) {
  const dao = new CompetitorDao(db);
  if (!await dao.ownedBrand(ownerId, brandId)) return denied("NOT_FOUND");
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
    ownership: row.ownership,
    pageStatus: row.pageStatus,
    state: row.state ?? "observed" as const,
    support: row.support ?? "unknown" as const,
    recorded: row.state !== null,
  };
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
  ownerId: string,
  input: InspectCitationInput,
  clock: Clock = () => new Date().toISOString(),
) {
  const judged = inspectSource(input);
  return db.transaction(async (tx) => {
    const dao = new CompetitorDao(tx);
    if (!await dao.ownedBrand(ownerId, input.brandId)) return denied("NOT_FOUND");
    if (!await dao.citationOwned(ownerId, input.brandId, input.citationId)) return denied("NOT_FOUND");
    const now = clock();
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

export async function readCitationSources(db: DatabaseConnection, ownerId: string, brandId: string) {
  const dao = new CompetitorDao(db);
  if (!await dao.ownedBrand(ownerId, brandId)) return denied("NOT_FOUND");
  const listed = await dao.listCitationSources(ownerId, brandId);
  const citations = listed.rows.map(presentCitation);
  return { citations, hosts: citationHosts(citations), truncated: listed.truncated };
}

export async function proposeResearchBrief(
  db: DatabaseConnection,
  ownerId: string,
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
    const dao = new CompetitorDao(tx);
    if (!await dao.ownedBrand(ownerId, input.brandId)) return denied("NOT_FOUND");
    const ownedIds = await dao.citationIdsOwned(ownerId, input.brandId, sourceIds);
    if (ownedIds.length !== sourceIds.length) return { error: "INVALID_INPUT" as const, reason: "missing_evidence" as const };
    const now = clock();
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
  ownerId: string,
  input: BriefStatusInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return db.transaction(async (tx) => {
    const dao = new CompetitorDao(tx);
    if (!await dao.ownedBrand(ownerId, input.brandId)) return denied("NOT_FOUND");
    const updated = await dao.updateBriefStatus(ownerId, input.brandId, input.briefId, input.status, clock());
    if (!updated) return denied("OPERATION_CONFLICT");
    return { id: input.briefId, status: input.status };
  });
}

export async function readResearchBriefs(db: DatabaseConnection, ownerId: string, brandId: string) {
  const dao = new CompetitorDao(db);
  if (!await dao.ownedBrand(ownerId, brandId)) return denied("NOT_FOUND");
  const rows = await dao.listBriefs(ownerId, brandId);
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
  ownerId: string,
  brandId: string,
  version?: number,
) {
  const dao = new CompetitorDao(db);
  if (!await dao.ownedBrand(ownerId, brandId)) return denied("NOT_FOUND");
  const sets = await dao.listSets(ownerId, brandId);
  const selected = version === undefined ? sets.at(-1) ?? null : sets.find((item) => item.version === version) ?? null;
  if (version !== undefined && !selected) return denied("NOT_FOUND");
  const [mentions, observations, sources, briefs] = await Promise.all([
    selected ? dao.listMentions(ownerId, brandId, selected.id) : Promise.resolve({ truncated: false as const, rows: [] }),
    dao.listRecentObservations(ownerId, brandId),
    dao.listCitationSources(ownerId, brandId),
    dao.listBriefs(ownerId, brandId),
  ]);
  const labels = selected ? labelsOf(selected) : [];
  const share = selected && !mentions.truncated
    ? shareFromMentions(labels, mentions.rows)
    : emptyShare(labels);
  return {
    sets: sets.map((item) => ({ id: item.id, version: item.version, labels: labelsOf(item), createdAt: item.createdAt })),
    selected: selected ? { id: selected.id, version: selected.version, labels, createdAt: selected.createdAt } : null,
    ...share,
    truncated: mentions.truncated,
    observations,
    citations: sources.rows.map(presentCitation),
    hosts: citationHosts(sources.rows),
    sourcesTruncated: sources.truncated,
    briefs: briefs.map((row) => ({
      id: row.id,
      questionCluster: row.questionCluster,
      gap: row.gap,
      status: row.status,
      facts: zFacts(row.factsJson),
      sourceIds: zFacts(row.sourceIdsJson),
      copiedReplacement: false as const,
    })),
  };
}
