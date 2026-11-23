import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { classifyCrawler } from "./crawler-identity.ts";
import type { CrawlerObservationList, CrawlerObservationView, RegisterCrawlerVisitInput } from "./crawler-contracts.ts";
import { CrawlerObservationDao, type CrawlerObservationRecord } from "./crawler-dao.ts";

type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

function toView(row: CrawlerObservationRecord): CrawlerObservationView {
  const classified = classifyCrawler({
    userAgentClaimsAi: false,
    identityVerified: row.identity === "verified",
    answerCitations: row.citations,
  });
  if (classified.calledIncluded || classified.identity !== row.identity || classified.citations !== row.citations) {
    throw new Error("crawler-visit-marked-included");
  }
  return {
    id: row.id,
    brandId: row.brandId,
    identity: classified.identity,
    citations: classified.citations,
    calledIncluded: classified.calledIncluded,
    observedAt: row.observedAt,
  };
}

export async function listCrawlerVisits(db: DatabaseConnection, ownerId: string): Promise<CrawlerObservationList> {
  return db.transaction(async (tx) => {
    const dao = new CrawlerObservationDao(tx);
    const brands = await dao.activeBrandIds(ownerId);
    const observations = await dao.observationsForOwner(ownerId);
    return { brands, observations: observations.map(toView) };
  });
}

export async function readCrawlerVisit(db: DatabaseConnection, ownerId: string, observationId: string) {
  return db.transaction(async (tx) => {
    const dao = new CrawlerObservationDao(tx);
    const [row] = await dao.observationsByIds(ownerId, [observationId]);
    if (!row) return { error: "NOT_FOUND" as const };
    return { observation: toView(row) };
  });
}

export async function registerCrawlerVisit(
  db: DatabaseConnection,
  ownerId: string,
  input: RegisterCrawlerVisitInput,
  clock: Clock = systemClock,
): Promise<{ observation: CrawlerObservationView } | { error: "NOT_FOUND" }> {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned || owned.status !== "active") return { error: "NOT_FOUND" as const };
    const classified = classifyCrawler({
      userAgentClaimsAi: input.userAgentClaimsAi,
      identityVerified: input.identityVerified,
      answerCitations: input.answerCitations,
    });
    if (classified.calledIncluded) throw new Error("crawler-visit-marked-included");
    const id = randomUUID();
    const observedAt = clock();
    const dao = new CrawlerObservationDao(tx);
    await dao.insertObservations([{
      id,
      brandId: input.brandId,
      ownerId,
      identity: classified.identity,
      citations: classified.citations,
      calledIncluded: 0,
      observedAt,
    }]);
    const [stored] = await dao.observationsByIds(ownerId, [id]);
    if (!stored) throw new Error("crawler-visit-missing");
    return { observation: toView(stored) };
  });
}
