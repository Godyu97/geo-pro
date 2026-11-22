import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import type { CreateInterventionBatchInput, RegisterInterventionPageInput } from "./intervention-contracts.ts";
import {
  InterventionBatchDao,
  type InterventionBatchRecord,
  type InterventionPageRecord,
} from "./intervention-dao.ts";
import { batchEffectiveAt } from "./rules.ts";

type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

export type InterventionPageView = {
  id: string;
  pageKey: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InterventionBatchView = {
  id: string;
  brandId: string;
  status: InterventionBatchRecord["status"];
  effectiveAt: string | null;
  createdAt: string;
  updatedAt: string;
  pages: InterventionPageView[];
};

function toPage(row: InterventionPageRecord): InterventionPageView {
  return {
    id: row.id,
    pageKey: row.pageKey,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toBatch(row: InterventionBatchRecord, pages: readonly InterventionPageRecord[]): InterventionBatchView {
  return {
    id: row.id,
    brandId: row.brandId,
    status: row.status,
    effectiveAt: row.effectiveAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pages: pages.filter((page) => page.batchId === row.id).map(toPage),
  };
}

function pointFrom(verifiedAt: readonly (string | null)[]) {
  const effectiveAt = batchEffectiveAt(verifiedAt);
  if (effectiveAt === null) return { status: "pending" as const, effectiveAt: null };
  return { status: "effective" as const, effectiveAt };
}

type BatchResult = { batch: InterventionBatchView } | { error: "NOT_FOUND" };
type ListResult = { batches: InterventionBatchView[] } | { error: "NOT_FOUND" };
type EffectiveSync =
  | { error: "NOT_FOUND" }
  | { status: "pending"; effectiveAt: null; pages: InterventionPageRecord[] }
  | { status: "effective"; effectiveAt: string; pages: InterventionPageRecord[] };

// One page read, then one batch write. A null verification or an empty list stays pending.
async function syncEffectivePoint(
  dao: InterventionBatchDao,
  ownerId: string,
  batchId: string,
  updatedAt: string,
): Promise<EffectiveSync> {
  const pages = await dao.pagesForBatch(ownerId, batchId);
  const point = pointFrom(pages.map((page) => page.verifiedAt));
  const wrote = await dao.writeEffectivePoint(ownerId, batchId, point, updatedAt);
  if (!wrote) return { error: "NOT_FOUND" };
  if (point.status === "pending") return { status: "pending", effectiveAt: null, pages };
  return { status: "effective", effectiveAt: point.effectiveAt, pages };
}

export async function listInterventionBatches(db: DatabaseConnection, ownerId: string, brandId: string): Promise<ListResult> {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const dao = new InterventionBatchDao(tx);
    const batches = await dao.batchesForBrand(ownerId, brandId);
    const pages = await dao.pagesForBatches(ownerId, batches.map((batch) => batch.id));
    return { batches: batches.map((batch) => toBatch(batch, pages)) };
  });
}

export async function getInterventionBatch(db: DatabaseConnection, ownerId: string, batchId: string): Promise<BatchResult> {
  return db.transaction(async (tx) => {
    const dao = new InterventionBatchDao(tx);
    const batch = await dao.batchForOwner(ownerId, batchId, false);
    if (!batch) return { error: "NOT_FOUND" as const };
    const owned = await new BrandDao(tx).owned(ownerId, batch.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const pages = await dao.pagesForBatch(ownerId, batch.id);
    return { batch: toBatch(batch, pages) };
  });
}

export async function createInterventionBatch(
  db: DatabaseConnection,
  ownerId: string,
  input: CreateInterventionBatchInput,
  clock: Clock = systemClock,
): Promise<BatchResult> {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const now = clock();
    const point = pointFrom([]);
    const batch: InterventionBatchRecord = {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId,
      status: point.status,
      effectiveAt: point.effectiveAt,
      createdAt: now,
      updatedAt: now,
    };
    await new InterventionBatchDao(tx).insertBatch(batch);
    return { batch: toBatch(batch, []) };
  });
}

export async function registerInterventionPage(
  db: DatabaseConnection,
  ownerId: string,
  batchId: string,
  input: RegisterInterventionPageInput,
  clock: Clock = systemClock,
): Promise<BatchResult> {
  return db.transaction(async (tx) => {
    const dao = new InterventionBatchDao(tx);
    const batch = await dao.batchForOwner(ownerId, batchId, true);
    if (!batch) return { error: "NOT_FOUND" as const };
    const owned = await new BrandDao(tx).owned(ownerId, batch.brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const now = clock();
    await dao.upsertPage({
      id: randomUUID(),
      batchId: batch.id,
      brandId: batch.brandId,
      ownerId,
      pageKey: input.pageKey,
      verifiedAt: input.verifiedAt,
      createdAt: now,
      updatedAt: now,
    });
    const synced = await syncEffectivePoint(dao, ownerId, batch.id, now);
    if ("error" in synced) return { error: "NOT_FOUND" };
    return {
      batch: toBatch({
        ...batch,
        status: synced.status,
        effectiveAt: synced.effectiveAt,
        updatedAt: now,
      }, synced.pages),
    };
  });
}
