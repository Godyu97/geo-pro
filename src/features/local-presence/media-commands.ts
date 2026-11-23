import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { reviewMedia } from "./media.ts";
import {
  approvedFactValue,
  type ApprovedFactOption,
  type MediaReviewList,
  type MediaReviewView,
  type RecordMediaReviewInput,
} from "./media-contracts.ts";
import { MediaReviewDao, type ApprovedFactRecord, type MediaReviewRecord } from "./media-dao.ts";

type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

function toReviewView(row: MediaReviewRecord): MediaReviewView {
  return {
    id: row.id,
    brandId: row.brandId,
    kind: row.kind,
    shownValue: row.shownValue,
    approvedValue: row.approvedValue,
    factVersionId: row.factVersionId,
    reason: row.reason,
    deliver: row.deliver === 1,
    recordedAt: row.recordedAt,
  };
}

function toFactOption(row: ApprovedFactRecord): ApprovedFactOption | null {
  const approvedValue = approvedFactValue(row.content);
  if (!approvedValue) return null;
  return { id: row.id, brandId: row.brandId, version: row.version, approvedValue };
}

function visibleFacts(rows: readonly ApprovedFactRecord[]) {
  return rows.flatMap((row) => {
    const option = toFactOption(row);
    return option ? [option] : [];
  });
}

export async function listMediaReviews(db: DatabaseConnection, ownerId: string): Promise<MediaReviewList> {
  return db.transaction(async (tx) => {
    const dao = new MediaReviewDao(tx);
    const brands = await dao.activeBrandIds(ownerId);
    const facts = visibleFacts(await dao.approvedFactsForOwner(ownerId));
    const reviews = (await dao.reviewsForOwner(ownerId)).map(toReviewView);
    return { brands, facts, reviews };
  });
}

export async function readMediaReviewsForBrand(db: DatabaseConnection, ownerId: string, brandId: string) {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const dao = new MediaReviewDao(tx);
    const facts = visibleFacts(await dao.approvedFactsForBrand(ownerId, brandId));
    const reviews = (await dao.reviewsForBrand(ownerId, brandId)).map(toReviewView);
    return { brandId, facts, reviews };
  });
}

export async function readMediaReview(db: DatabaseConnection, ownerId: string, reviewId: string) {
  return db.transaction(async (tx) => {
    const [review] = await new MediaReviewDao(tx).reviewsByIds(ownerId, [reviewId]);
    if (!review) return { error: "NOT_FOUND" as const };
    return { review: toReviewView(review) };
  });
}

export async function recordMediaReview(
  db: DatabaseConnection,
  ownerId: string,
  input: RecordMediaReviewInput,
  clock: Clock = systemClock,
): Promise<{ review: MediaReviewView } | { error: "NOT_FOUND" }> {
  return db.transaction(async (tx) => {
    const dao = new MediaReviewDao(tx);
    const fact = await dao.approvedFactForBrand(ownerId, input.brandId, input.factVersionId);
    if (!fact) return { error: "NOT_FOUND" as const };
    const approvedValue = approvedFactValue(fact.content);
    if (!approvedValue) return { error: "NOT_FOUND" as const };
    const decision = reviewMedia({
      shownValue: input.shownValue,
      approvedValue,
      factVersion: fact.version,
      presentedAsCustomerProof: input.presentedAsCustomerProof,
    });
    if (
      decision.factVersion !== fact.version
      || decision.deliver !== (decision.reason === "ok")
      || (decision.reason === "ok" && input.shownValue !== approvedValue)
      || (decision.reason === "fact_mismatch" && (input.shownValue === approvedValue || input.presentedAsCustomerProof))
      || (decision.reason === "not_proof" && !input.presentedAsCustomerProof)
    ) {
      throw new Error("media-review-decision");
    }
    const id = randomUUID();
    const recordedAt = clock();
    await dao.insertReview({
      id,
      brandId: input.brandId,
      ownerId,
      kind: input.kind,
      shownValue: input.shownValue,
      approvedValue,
      factVersionId: fact.id,
      reason: decision.reason,
      deliver: decision.deliver ? 1 : 0,
      recordedAt,
    });
    const [stored] = await dao.reviewsByIds(ownerId, [id]);
    if (
      !stored
      || stored.factVersionId !== fact.id
      || stored.shownValue !== input.shownValue
      || stored.approvedValue !== approvedValue
      || stored.reason !== decision.reason
      || stored.deliver !== (decision.deliver ? 1 : 0)
    ) {
      throw new Error("media-review-missing");
    }
    return { review: toReviewView(stored) };
  });
}
