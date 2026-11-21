import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { createObjectStorage } from "../../lib/storage/index.ts";
import { BrandDao } from "../brands/dao.ts";
import { PromptDao } from "../prompts/dao.ts";
import { saveStoredObject, type ObjectStorageClient } from "../stored-objects/commands.ts";
import { MAX_OWNED_EXPORT_BYTES } from "../stored-objects/contracts.ts";
import { loadOwnedObject, markObjectFailed } from "../stored-objects/dao.ts";
import { exportFileName, exportScopeBits, exportScopes, type ExportRequest, type ExportScope, type ExportSummary } from "./contracts.ts";
import { readExportProfile, readExportRecord, readExportRecordByObject, saveExportRecord, type ExportRecord } from "./dao.ts";
import { exportSectionBytes, readExportSection } from "./sections.ts";

const formatVersion = 1;
const pageSize = 64;

function selectedScopes(mask: number) {
  return exportScopes.filter((scope) => (exportScopeBits[scope] & mask) !== 0);
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
    if (bytes > exportSectionBytes) throw new Error("Brand export size exceeds the limit");
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

export type ExportStorageOptions = {
  env?: Record<string, string | undefined>;
  storage?: ObjectStorageClient;
  now?: Date;
};

export type ExportFile = { summary: ExportSummary; body: string };
export type ExportRead = ExportFile | { error: "SERVICE_UNAVAILABLE" } | null;

const testStorageEnv = {
  S3_ENDPOINT: "http://127.0.0.1:9",
  S3_REGION: "us-east-1",
  S3_BUCKET: "app-files",
  S3_ACCESS_KEY_ID: "local-app",
  S3_SECRET_ACCESS_KEY: "s3-secret-not-for-logs",
  S3_FORCE_PATH_STYLE: "true",
};

let sharedTestStorage: ObjectStorageClient | undefined;

function memoryObjectStorage(): ObjectStorageClient {
  const objects = new Map<string, Uint8Array>();
  return {
    async putAndReadBack({ key, body, contentType }) {
      const copy = Uint8Array.from(body);
      objects.set(key, copy);
      return {
        ok: true,
        status: "ready",
        bucket: testStorageEnv.S3_BUCKET,
        key,
        byteSize: copy.byteLength,
        sha256: createHash("sha256").update(copy).digest("hex"),
        contentType,
      };
    },
    async getObject({ key }) {
      const body = objects.get(key);
      if (!body) return { ok: false, status: "failed", code: "unavailable" };
      return { ok: true, body, byteSize: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") };
    },
    async deleteObject({ key }) {
      objects.delete(key);
      return { ok: true };
    },
    async presignGet() {
      return { ok: false, status: "failed", code: "unavailable" };
    },
  };
}

function storageOptions(options: ExportStorageOptions, connection?: QueryConnection) {
  const explicit = Boolean(options.storage || options.env);
  const storage = options.storage ?? (!explicit && process.env.NODE_TEST_CONTEXT
    ? (sharedTestStorage ??= memoryObjectStorage())
    : undefined);
  const env = options.env ?? (storage && !options.storage ? testStorageEnv : undefined);
  return {
    ...(env ? { env } : {}),
    ...(storage ? { storage } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(connection ? { connection } : {}),
  };
}

function storageClient(options: ExportStorageOptions) {
  return options.storage ?? storageOptions(options).storage ?? createObjectStorage(options.env ? { env: options.env } : {});
}

function documentBody(record: ExportRecord, data: Partial<Record<ExportScope, unknown>>) {
  return JSON.stringify({ schemaVersion: formatVersion, ...summarize(record), unavailable: [], data });
}

async function readScope(db: QueryConnection, ownerId: string, scope: ExportScope) {
  if (scope === "profile") return readExportProfile(db, ownerId);
  if (scope === "brands") return readBrands(new BrandDao(db), db, ownerId);
  return readExportSection(db, ownerId, scope);
}

async function collectSections(db: TransactionConnection, ownerId: string, scopes: readonly ExportScope[], isolate: boolean) {
  const data: Partial<Record<ExportScope, unknown>> = {};
  for (const scope of exportScopes) {
    if (!scopes.includes(scope)) continue;
    const value = isolate
      ? await readSection(db, scope, (section) => readScope(section, ownerId, scope))
      : await readScope(db, ownerId, scope);
    if (value !== undefined) data[scope] = value;
  }
  return data;
}

function includedMask(data: Partial<Record<ExportScope, unknown>>) {
  return exportScopes.reduce((mask, scope) => data[scope] === undefined ? mask : mask | exportScopeBits[scope], 0);
}

export async function prepareExport(
  db: DatabaseConnection,
  ownerId: string,
  input: ExportRequest,
  options: ExportStorageOptions = {},
) {
  return db.transaction(async (tx) => {
    const brands = new BrandDao(tx);
    if (!await brands.lockOwner(ownerId)) return { error: "SESSION_REQUIRED" } as const;
    const previous = await readExportRecord(tx, ownerId);
    if ((previous?.id ?? null) !== input.previousId) return { error: "CONFLICT" } as const;

    const requested = input.scopes.reduce((mask, scope) => mask | exportScopeBits[scope], 0);
    const data = await collectSections(tx, ownerId, input.scopes, true);
    const included = includedMask(data);
    const record: ExportRecord = {
      id: randomUUID(),
      locale: input.locale,
      createdAt: (options.now ?? new Date()).toISOString(),
      requested,
      included,
      fingerprint: included ? fingerprint(data) : null,
      objectId: null,
    };
    if (!included) {
      await saveExportRecord(tx, ownerId, record);
      return { summary: summarize(record) };
    }

    const body = documentBody(record, data);
    const bytes = new TextEncoder().encode(body);
    if (bytes.byteLength > MAX_OWNED_EXPORT_BYTES) return { error: "SERVICE_UNAVAILABLE" } as const;
    const fileName = exportFileName(summarize(record));
    const saved = await saveStoredObject(db, {
      actorId: ownerId,
      brandId: null,
      class: "owned-export",
      visibility: "internal",
      fileName,
      contentType: "application/json",
      body: bytes,
    }, storageOptions(options, tx));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (!saved.ok || saved.class !== "owned-export" || saved.visibility !== "internal" || saved.fileName !== fileName
      || saved.contentType !== "application/json" || saved.byteSize !== bytes.byteLength || saved.sha256 !== digest) {
      return { error: "SERVICE_UNAVAILABLE" } as const;
    }
    record.objectId = saved.id;
    await saveExportRecord(tx, ownerId, record);
    return { summary: summarize(record) };
  });
}

type OpenedExport = {
  summary: ExportSummary;
  fingerprint: string;
  objectId: string;
  key: string;
  sha256: string;
  byteSize: number;
};

async function openExport(
  db: DatabaseConnection,
  ownerId: string,
  id: string,
  brandsAllowed: boolean,
): Promise<ExportFile | OpenedExport | null> {
  return db.transaction(async (tx) => {
    const brands = new BrandDao(tx);
    if (!await brands.lockOwner(ownerId)) return null;
    const record = await readExportRecord(tx, ownerId, id);
    if (!record?.fingerprint) return null;
    const summary = summarize(record);
    if (summary.included.some((scope) => scope !== "profile") && !brandsAllowed) return null;

    const data = await collectSections(tx, ownerId, summary.included, false);
    if (fingerprint(data) !== record.fingerprint) return null;
    if (!record.objectId) return { summary, body: documentBody(record, data) };

    const row = await loadOwnedObject(tx, ownerId, record.objectId);
    if (!row || row.status !== "ready" || row.class !== "owned-export" || row.visibility !== "internal"
      || row.brandId !== null || row.immutable !== 1 || row.contentType !== "application/json"
      || !row.fileName || row.fileName.includes("/") || row.fileName.includes("..") || !row.fileName.endsWith(".json")
      || !row.objectKey) {
      return null;
    }
    return {
      summary,
      fingerprint: record.fingerprint,
      objectId: row.id,
      key: row.objectKey,
      sha256: row.sha256,
      byteSize: row.byteSize,
    };
  });
}

function storedExport(value: ExportFile | OpenedExport): value is OpenedExport {
  return "key" in value;
}

export async function readExportFile(
  db: DatabaseConnection,
  ownerId: string,
  id: string,
  brandsAllowed: boolean,
  options: ExportStorageOptions = {},
): Promise<ExportRead> {
  const opened = await openExport(db, ownerId, id, brandsAllowed);
  if (!opened) return null;
  if (!storedExport(opened)) return opened;

  const storage = storageClient(options);
  if (!storage) return { error: "SERVICE_UNAVAILABLE" };
  let loaded: Awaited<ReturnType<ObjectStorageClient["getObject"]>>;
  try {
    loaded = await storage.getObject({ key: opened.key });
  } catch {
    return { error: "SERVICE_UNAVAILABLE" };
  }
  if (!loaded.ok) return { error: "SERVICE_UNAVAILABLE" };
  let text: string;
  let dataFingerprint: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(loaded.body);
    dataFingerprint = fingerprint((JSON.parse(text) as { data?: unknown }).data);
  } catch {
    text = "";
    dataFingerprint = "";
  }
  if (loaded.sha256 !== opened.sha256 || loaded.byteSize !== opened.byteSize || dataFingerprint !== opened.fingerprint) {
    await storage.deleteObject({ key: opened.key });
    await db.transaction((tx) => markObjectFailed(tx, opened.objectId, ownerId, "ready"));
    return { error: "SERVICE_UNAVAILABLE" };
  }
  return { summary: opened.summary, body: text };
}

export async function readOwnedExportByObject(
  db: DatabaseConnection,
  ownerId: string,
  objectId: string,
  brandsAllowed: boolean,
  options: ExportStorageOptions = {},
): Promise<ExportRead> {
  const record = await readExportRecordByObject(db, ownerId, objectId);
  if (!record || record.objectId !== objectId) return null;
  return readExportFile(db, ownerId, record.id, brandsAllowed, options);
}
