import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { conditionalMeanPosition, mentionShare } from "../competitor-share/rules.ts";
import type { CompetitorError, RecordMentionsInput, SaveCompetitorSetInput } from "./contracts.ts";
import { normalizeCompetitorLabels } from "./contracts.ts";
import { CompetitorDao, type CompetitorMentionRow, type CompetitorSetRow } from "./dao.ts";

type Clock = () => string;
type Failure = { error: CompetitorError };

function denied(error: CompetitorError): Failure {
  return { error };
}

export function labelsOf(row: CompetitorSetRow) {
  return normalizeCompetitorLabels(JSON.parse(row.labelsJson) as string[]) ?? [];
}

export function shareFromMentions(
  labels: readonly string[],
  mentions: readonly Pick<CompetitorMentionRow, "observationId" | "competitorLabel" | "ordered" | "position">[],
) {
  const rows = mentionShare(
    mentions.map((mention) => ({ answerId: mention.observationId, brandId: mention.competitorLabel })),
    labels,
  );
  const orderedMentions = mentions.filter((mention): mention is typeof mention & { position: number } => (
    mention.ordered === 1 && mention.position !== null
  ));
  const unorderedCount = mentions.filter((mention) => mention.ordered === 0).length;
  if (orderedMentions.length === 0) {
    return {
      rows,
      rank: { ranked: false as const, mean: null, excludedAbsent: [...labels], unorderedCount },
    };
  }
  const present = new Set(orderedMentions.map((mention) => mention.competitorLabel));
  const stats = conditionalMeanPosition({
    ordered: true,
    ranked: orderedMentions.map((mention) => ({ brandId: mention.competitorLabel, position: mention.position })),
    absentBrandIds: labels.filter((label) => !present.has(label)),
  });
  return {
    rows,
    rank: {
      ranked: true as const,
      mean: stats.ranked ? stats.mean : null,
      excludedAbsent: stats.excludedAbsent,
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
    const allowed = new Set(labelsOf(set));
    if (input.mentions.some((mention) => !allowed.has(mention.label))) return denied("INVALID_INPUT");
    const now = clock();
    for (const mention of input.mentions) {
      const ordered = input.ordered ? 1 : 0;
      const position = input.ordered ? mention.position ?? null : null;
      const existing = await dao.findMention(input.setId, input.observationId, mention.label);
      if (existing) {
        if (existing.ordered !== ordered || existing.position !== position) return denied("OPERATION_CONFLICT");
        continue;
      }
      await dao.insertMention({
        id: randomUUID(),
        brandId: input.brandId,
        ownerId,
        setId: input.setId,
        observationId: input.observationId,
        competitorLabel: mention.label,
        ordered,
        position,
        createdAt: now,
      });
    }
    return { recorded: input.mentions.length };
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
      rows: [],
      rank: { ranked: false as const, mean: null, excludedAbsent: [] as string[], unorderedCount: 0 },
      truncated: false,
    };
  }
  const mentions = await dao.listMentions(ownerId, brandId, selected.id);
  const labels = labelsOf(selected);
  if (mentions.truncated) {
    return {
      sets: sets.map((item) => ({ id: item.id, version: item.version, labels: labelsOf(item), createdAt: item.createdAt })),
      selected: { id: selected.id, version: selected.version, labels, createdAt: selected.createdAt },
      rows: [],
      rank: { ranked: false as const, mean: null, excludedAbsent: [...labels], unorderedCount: 0 },
      truncated: true,
    };
  }
  const share = shareFromMentions(labels, mentions.rows);
  return {
    sets: sets.map((item) => ({ id: item.id, version: item.version, labels: labelsOf(item), createdAt: item.createdAt })),
    selected: { id: selected.id, version: selected.version, labels, createdAt: selected.createdAt },
    rows: share.rows,
    rank: share.rank,
    truncated: false,
  };
}
