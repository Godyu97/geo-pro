import "server-only";

import type { QueryConnection } from "../../lib/db/connection.ts";
import { factStatus } from "../brand-facts/rules.ts";
import { FactDao } from "../brand-facts/dao.ts";
import { draftContent } from "../prompts/contracts.ts";
import {
  compareAnswerToFacts,
  excerptText,
  type BrandFactClaimView,
  type ComparableFact,
} from "./claims.ts";
import { BrandFactClaimDao } from "./dao.ts";

const questionIdLimit = 100;

type Clock = () => string;

function todayOf(clock: Clock) {
  return clock().slice(0, 10);
}

function brandFactQuestionIds(contents: readonly string[]) {
  const ids = new Set<string>();
  for (const content of contents) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      continue;
    }
    const draft = draftContent.safeParse(parsed);
    if (!draft.success) continue;
    for (const question of draft.data.questions) {
      if (question.type === "brand_fact" && question.status !== "inactive") ids.add(question.id);
    }
  }
  return [...ids].sort().slice(0, questionIdLimit);
}

async function currentFacts(db: QueryConnection, ownerId: string, brandId: string, today: string) {
  const versions = await new FactDao(db, { ownerId, brandId }).latestVersions();
  const facts: ComparableFact[] = [];
  for (const version of versions) {
    const status = factStatus(version, today);
    if (status !== "approved" && status !== "expired" && status !== "revoked") continue;
    facts.push({
      id: version.id,
      category: version.fields.category,
      title: version.fields.title,
      claim: version.fields.claim,
      status,
    });
  }
  return facts;
}

export type LoadedBrandFactClaim = {
  view: BrandFactClaimView;
  answerText: string;
  facts: ComparableFact[];
};

async function loadClaims(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  clock: Clock,
  observationId?: string,
): Promise<LoadedBrandFactClaim[]> {
  const dao = new BrandFactClaimDao(db);
  const [promptSetIds, facts] = await Promise.all([
    dao.promptSetIds(ownerId, brandId),
    currentFacts(db, ownerId, brandId, todayOf(clock)),
  ]);
  const contents = await dao.promptContents(brandId, promptSetIds);
  const questionIds = brandFactQuestionIds(contents.map((row) => row.content));
  const rows = await dao.observations(ownerId, brandId, questionIds, observationId);
  return rows.map((row) => {
    const compared = compareAnswerToFacts(row.answerText, facts);
    return {
      answerText: row.answerText,
      facts,
      view: {
        ...compared,
        observationId: row.observationId,
        analysisVersionId: row.analysisVersionId,
        questionText: excerptText(row.questionText, 240),
        answerExcerpt: excerptText(row.answerText),
      },
    };
  });
}

export async function listBrandFactClaims(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  clock: Clock = () => new Date().toISOString(),
) {
  const loaded = await loadClaims(db, ownerId, brandId, clock);
  return loaded.map((item) => item.view);
}

export async function loadBrandFactClaim(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  observationId: string,
  clock: Clock = () => new Date().toISOString(),
) {
  const [loaded] = await loadClaims(db, ownerId, brandId, clock, observationId);
  return loaded ?? null;
}
