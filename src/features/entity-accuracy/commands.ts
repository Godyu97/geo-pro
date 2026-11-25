import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { BrandDao, type BrandRecord } from "../brands/dao.ts";
import { listBrandFactClaims } from "./claim-read.ts";
import type { BrandFactClaimView } from "./claims.ts";
import { entityReviewWriteSchema } from "./contracts.ts";
import { EntityReviewDao, type EntityReviewRecord } from "./dao.ts";
import { reviewedErrorDisplay } from "./rules.ts";

type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

function uniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /UNIQUE|duplicate key|entity_review_sample_uidx/i.test(message);
}

export type EntityReviewBoard = {
  errorLabel: string | null;
  coverage: string | null;
  populationRate: null;
  label: "sample" | "insufficient";
  method: string | null;
  reviews: Array<{
    id: string;
    observationId: string;
    analysisVersionId: string;
    confirmed: boolean;
  }>;
};

function newest(rows: readonly EntityReviewRecord[]) {
  return rows.reduce<EntityReviewRecord | undefined>((best, row) => {
    if (!best || row.createdAt > best.createdAt || (row.createdAt === best.createdAt && row.id > best.id)) return row;
    return best;
  }, undefined);
}

export function presentEntityReviewBoard(rows: readonly EntityReviewRecord[]): EntityReviewBoard {
  const latest = new Map<string, EntityReviewRecord>();
  for (const row of rows) {
    const key = `${row.observationId}:${row.analysisVersionId}`;
    const current = latest.get(key);
    if (!current || row.createdAt > current.createdAt || (row.createdAt === current.createdAt && row.id > current.id)) {
      latest.set(key, row);
    }
  }
  const frame = newest(rows);
  const reviewedRows = [...latest.values()].filter((row) => row.reviewed === 1);
  const display = reviewedErrorDisplay({
    reviewed: reviewedRows.length,
    population: frame?.populationCount ?? 0,
    confirmedErrors: reviewedRows.filter((row) => row.confirmedError === 1).length,
    method: frame?.method ?? "",
  });
  return {
    errorLabel: display.errorLabel,
    coverage: display.coverageLabel,
    populationRate: null,
    label: display.label,
    method: frame?.method ?? null,
    reviews: reviewedRows
      .map((row) => ({
        id: row.id,
        observationId: row.observationId,
        analysisVersionId: row.analysisVersionId,
        confirmed: row.confirmedError === 1,
      }))
      .sort((left, right) => left.observationId.localeCompare(right.observationId) || left.id.localeCompare(right.id)),
  };
}

export type EntityReviewWorkspace = {
  brandName: string;
  brandStatus: BrandRecord["status"];
  board: EntityReviewBoard;
  claims: BrandFactClaimView[];
};

export function entityReviewUnavailable(error: unknown) {
  const traceId = randomUUID();
  console.error("entity-reviews-page-unavailable", {
    traceId,
    message: error instanceof Error ? error.message : "unknown",
  });
  return { error: "SERVICE_UNAVAILABLE" as const, traceId };
}

export async function listEntityReviews(db: DatabaseConnection, ownerId: string, brandId: string) {
  const owned = await new BrandDao(db).owned(ownerId, brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const rows = await new EntityReviewDao(db).reviewsForBrand(ownerId, brandId);
  return { board: presentEntityReviewBoard(rows) };
}

export async function readEntityReviewWorkspace(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
): Promise<EntityReviewWorkspace | { error: "NOT_FOUND" }> {
  const owned = await new BrandDao(db).ownedSummary(ownerId, brandId);
  if (!owned) return { error: "NOT_FOUND" as const };
  const reviews = new EntityReviewDao(db);
  const [rows, claims] = await Promise.all([
    reviews.reviewsForBrand(ownerId, brandId),
    listBrandFactClaims(db, ownerId, brandId),
  ]);
  return {
    brandName: owned.name,
    brandStatus: owned.status,
    board: presentEntityReviewBoard(rows),
    claims,
  };
}

export async function recordEntityReviews(
  db: DatabaseConnection,
  ownerId: string,
  input: unknown,
  clock: Clock = systemClock,
) {
  const parsed = entityReviewWriteSchema.safeParse(input);
  if (!parsed.success) return { error: "INVALID_INPUT" as const };
  try {
    return await db.transaction(async (tx) => {
      const owned = await new BrandDao(tx).owned(ownerId, parsed.data.brandId);
      if (!owned) return { error: "NOT_FOUND" as const };
      const now = clock();
      const dao = new EntityReviewDao(tx);
      await dao.insertReviews(parsed.data.marks.map((mark) => ({
        id: randomUUID(),
        brandId: parsed.data.brandId,
        ownerId,
        observationId: mark.observationId,
        analysisVersionId: mark.analysisVersionId,
        confirmedError: mark.confirmed ? 1 : 0,
        reviewed: mark.reviewed ? 1 : 0,
        populationCount: parsed.data.population,
        method: parsed.data.method,
        fact: mark.fact,
        createdAt: now,
      })));
      const rows = await dao.reviewsForBrand(ownerId, parsed.data.brandId);
      return { recorded: true as const, board: presentEntityReviewBoard(rows) };
    });
  } catch (error) {
    if (uniqueConflict(error)) return { error: "INVALID_INPUT" as const };
    throw error;
  }
}
