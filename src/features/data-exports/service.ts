import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { PromptDao } from "../prompts/dao.ts";
import { exportScopes, type ExportRequest, type ExportScope, type ExportSummary } from "./contracts.ts";
import { readExportProfile, readExportRecord, saveExportRecord, type ExportRecord } from "./dao.ts";

const scopeBits: Record<ExportScope, number> = { profile: 1, brands: 2 };
const formatVersion = 1;
const pageSize = 64;
const maxBrandBytes = 8 * 1024 * 1024;

function selectedScopes(mask: number) {
  return exportScopes.filter((scope) => (scopeBits[scope] & mask) !== 0);
}

function summarize(record: ExportRecord): ExportSummary {
  const { id, locale, createdAt, requested, included } = record;
  return {
    id, locale, createdAt,
    status: included === requested ? "ready" : included === 0 ? "failed" : "partial",
    requested: selectedScopes(requested),
    included: selectedScopes(included),
    missing: selectedScopes(requested & ~included),
  };
}

export async function getExportSummary(db: QueryConnection, ownerId: string) {
  const record = await readExportRecord(db, ownerId);
  return record ? summarize(record) : null;
}

async function readBrands(dao: BrandDao, db: QueryConnection, ownerId: string) {
  const versions: Awaited<ReturnType<BrandDao["exportVersions"]>> = [];
  const drafts: Awaited<ReturnType<BrandDao["exportDrafts"]>> = [];
  let bytes = 0;
  function append<T>(target: T[], page: T[]) {
    for (const row of page) bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
    if (bytes > maxBrandBytes) throw new Error("Brand export size exceeds the limit");
    target.push(...page);
  }

  let versionPage = await dao.exportVersions(ownerId, pageSize);
  for (;;) {
    append(versions, versionPage);
    const after = versionPage.at(-1);
    if (versionPage.length < pageSize || !after) break;
    versionPage = await dao.exportVersions(ownerId, pageSize, after);
  }

  let draftPage = await dao.exportDrafts(ownerId, pageSize, "");
  for (;;) {
    append(drafts, draftPage);
    const after = draftPage.at(-1);
    if (draftPage.length < pageSize || !after) break;
    draftPage = await dao.exportDrafts(ownerId, pageSize, after.scope);
  }

  const prompts = new PromptDao(db);
  const promptDrafts: Awaited<ReturnType<PromptDao["exportDrafts"]>> = [];
  const promptSets: Awaited<ReturnType<PromptDao["exportSets"]>> = [];
  let promptDraftPage = await prompts.exportDrafts(ownerId, pageSize, "");
  for (;;) {
    append(promptDrafts, promptDraftPage);
    const after = promptDraftPage.at(-1);
    if (promptDraftPage.length < pageSize || !after) break;
    promptDraftPage = await prompts.exportDrafts(ownerId, pageSize, after.brandId);
  }
  let promptSetPage = await prompts.exportSets(ownerId, pageSize);
  for (;;) {
    append(promptSets, promptSetPage);
    const after = promptSetPage.at(-1);
    if (promptSetPage.length < pageSize || !after) break;
    promptSetPage = await prompts.exportSets(ownerId, pageSize, { brandId: after.brandId, at: after.createdAt, id: after.id });
  }

  return promptDrafts.length || promptSets.length ? { versions, drafts, promptDrafts, promptSets } : { versions, drafts };
}

async function readSection<T>(db: TransactionConnection, scope: ExportScope, read: (connection: QueryConnection) => Promise<T>) {
  try {
    return await db.savepoint(read);
  } catch {
    console.error("data-export-section-unavailable", { scope });
    return undefined;
  }
}

function fingerprint(data: unknown) {
  return createHash("sha256").update(JSON.stringify([formatVersion, data])).digest("hex");
}

export async function prepareExport(db: DatabaseConnection, ownerId: string, input: ExportRequest) {
  return db.transaction(async (tx) => {
    const brands = new BrandDao(tx);
    if (!await brands.lockOwner(ownerId)) return { error: "SESSION_REQUIRED" } as const;
    const previous = await readExportRecord(tx, ownerId);
    if ((previous?.id ?? null) !== input.previousId) return { error: "CONFLICT" } as const;

    const requested = input.scopes.reduce((mask, scope) => mask | scopeBits[scope], 0);
    const data = {
      profile: input.scopes.includes("profile") ? await readSection(tx, "profile", (section) => readExportProfile(section, ownerId)) : undefined,
      brands: input.scopes.includes("brands") ? await readSection(tx, "brands", (section) => readBrands(new BrandDao(section), section, ownerId)) : undefined,
    };
    const included = (data.profile ? scopeBits.profile : 0) | (data.brands ? scopeBits.brands : 0);
    const record = {
      id: randomUUID(), locale: input.locale, createdAt: new Date().toISOString(),
      requested, included, fingerprint: included ? fingerprint(data) : null,
    };
    await saveExportRecord(tx, ownerId, record);
    return { summary: summarize(record) };
  });
}

export async function readExportFile(db: DatabaseConnection, ownerId: string, id: string, brandsAllowed: boolean) {
  return db.transaction(async (tx) => {
    const brands = new BrandDao(tx);
    if (!await brands.lockOwner(ownerId)) return null;
    const record = await readExportRecord(tx, ownerId, id);
    if (!record?.fingerprint) return null;
    const summary = summarize(record);
    if (summary.included.includes("brands") && !brandsAllowed) return null;

    const data = {
      profile: summary.included.includes("profile") ? await readExportProfile(tx, ownerId) : undefined,
      brands: summary.included.includes("brands") ? await readBrands(brands, tx, ownerId) : undefined,
    };
    if (fingerprint(data) !== record.fingerprint) return null;

    return {
      summary,
      body: JSON.stringify({
        schemaVersion: formatVersion,
        ...summary,
        unavailable: ["factsAndMaterials", "monitoringAndEvidence", "content", "reports", "usageAndCosts"],
        data,
      }),
    };
  });
}
