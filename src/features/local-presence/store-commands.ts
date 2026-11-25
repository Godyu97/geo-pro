import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { storeFacts } from "./rules.ts";
import type { BrandStoreList, BrandStoreView, RecordStoreFactUseInput, RegisterBrandStoreInput, StoreFactUseView } from "./store-contracts.ts";
import { BrandStoreDao, type BrandStoreRecord, type StoreFactUseRecord } from "./store-dao.ts";

type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

function toStoreView(row: BrandStoreRecord): BrandStoreView {
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    serviceArea: row.serviceArea,
    createdAt: row.createdAt,
  };
}

function toUseView(row: StoreFactUseRecord): StoreFactUseView {
  return {
    id: row.id,
    storeId: row.storeId,
    serviceArea: row.serviceArea,
    usedOtherStore: false,
    recordedAt: row.recordedAt,
  };
}

export function brandStoresUnavailable(error: unknown) {
  const traceId = randomUUID();
  console.error("brand-stores-page-unavailable", {
    traceId,
    message: error instanceof Error ? error.message : "unknown",
  });
  return { error: "SERVICE_UNAVAILABLE" as const, traceId };
}

export async function listBrandStores(db: DatabaseConnection, ownerId: string): Promise<BrandStoreList> {
  return db.transaction(async (tx) => {
    const dao = new BrandStoreDao(tx);
    const brands = await dao.activeBrandIds(ownerId);
    const stores = await dao.storesForOwner(ownerId);
    const uses = await dao.usesForOwner(ownerId);
    return { brands, stores: stores.map(toStoreView), uses: uses.map(toUseView) };
  });
}

export async function readBrandStoresForBrand(db: DatabaseConnection, ownerId: string, brandId: string) {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, brandId);
    if (!owned) return { error: "NOT_FOUND" as const };
    const dao = new BrandStoreDao(tx);
    const stores = await dao.storesForBrand(ownerId, brandId);
    const uses = await dao.usesForStores(ownerId, stores.map((store) => store.id));
    return { brandId, stores: stores.map(toStoreView), uses: uses.map(toUseView) };
  });
}

export async function readBrandStore(db: DatabaseConnection, ownerId: string, storeId: string) {
  return db.transaction(async (tx) => {
    const dao = new BrandStoreDao(tx);
    const [store] = await dao.storesByIds(ownerId, [storeId]);
    if (!store) return { error: "NOT_FOUND" as const };
    const uses = await dao.usesForStores(ownerId, [store.id]);
    return { store: toStoreView(store), uses: uses.map(toUseView) };
  });
}

export async function registerBrandStore(
  db: DatabaseConnection,
  ownerId: string,
  input: RegisterBrandStoreInput,
  clock: Clock = systemClock,
): Promise<{ store: BrandStoreView } | { error: "NOT_FOUND" }> {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned || owned.status !== "active") return { error: "NOT_FOUND" as const };
    const id = randomUUID();
    const createdAt = clock();
    const dao = new BrandStoreDao(tx);
    await dao.insertStores([{
      id,
      brandId: input.brandId,
      ownerId,
      name: input.name,
      serviceArea: input.serviceArea,
      createdAt,
    }]);
    const [stored] = await dao.storesByIds(ownerId, [id]);
    if (!stored) throw new Error("brand-store-missing");
    return { store: toStoreView(stored) };
  });
}

export async function recordStoreFactUse(
  db: DatabaseConnection,
  ownerId: string,
  storeId: string,
  input: RecordStoreFactUseInput,
  clock: Clock = systemClock,
): Promise<{ use: StoreFactUseView } | { error: "NOT_FOUND" | "OTHER_STORE" }> {
  return db.transaction(async (tx) => {
    const dao = new BrandStoreDao(tx);
    const siblings = await dao.storesForStoreBrand(ownerId, storeId);
    const selected = siblings.find((store) => store.id === storeId);
    if (!selected) return { error: "NOT_FOUND" as const };
    const other = siblings.find((store) => store.id !== selected.id) ?? null;
    const facts = storeFacts({
      storeId: selected.id,
      serviceArea: selected.serviceArea,
      otherStoreArea: other?.serviceArea ?? null,
    });
    if (facts.usedOtherStore || facts.storeId !== selected.id || facts.serviceArea !== selected.serviceArea) {
      throw new Error("store-fact-mixed");
    }
    if (input.serviceArea !== facts.serviceArea) return { error: "OTHER_STORE" as const };
    const id = randomUUID();
    const recordedAt = clock();
    await dao.insertUses([{
      id,
      storeId: selected.id,
      ownerId,
      serviceArea: facts.serviceArea,
      usedOtherStore: 0,
      recordedAt,
    }]);
    const [stored] = await dao.usesByIds(ownerId, [id]);
    if (!stored || stored.serviceArea !== facts.serviceArea) throw new Error("store-fact-missing");
    return { use: toUseView(stored) };
  });
}
