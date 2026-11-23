import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { BrandDao } from "../brands/dao.ts";
import {
  presignStoredObject,
  readStoredObject,
  saveStoredObject,
  type ObjectStorageClient,
} from "../stored-objects/commands.ts";
import { markObjectFailed } from "../stored-objects/dao.ts";
import { classifySourceImport, type SourceDraft } from "./classify.ts";
import {
  importSourceOriginalsSchema,
  readSourceOriginalSchema,
  setSourceRightsSchema,
  type SourceError,
} from "./contracts.ts";
import {
  brandOwnedBy,
  insertSourceOriginals,
  listSourceOriginals,
  loadSourceOriginal,
  setSourceOriginalRights as writeRights,
  type SourceOriginalInsert,
  type SourceOriginalRow,
} from "./dao.ts";

const listLimit = 50;

export type SourceCommandOptions = {
  env?: Record<string, string | undefined>;
  storage?: ObjectStorageClient;
  now?: Date;
};

type Failure = { error: Extract<SourceError, "NOT_FOUND" | "INVALID_INPUT" | "SERVICE_UNAVAILABLE"> };

function denied(error: Failure["error"]): Failure {
  return { error };
}

function storageOptions(options: SourceCommandOptions) {
  return {
    ...(options.env ? { env: options.env } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.now ? { now: options.now } : {}),
  };
}

async function openBrand(db: QueryConnection, ownerId: string, brandId: string) {
  const brand = await brandOwnedBy(db, ownerId, brandId);
  if (!brand || brand.status !== "active" || brand.frozenAt !== null) return null;
  return brand;
}

export async function importSourceOriginals(
  db: DatabaseConnection,
  ownerId: string,
  input: { brandId: string; files: readonly SourceDraft[] },
  options: SourceCommandOptions = {},
) {
  const parsed = importSourceOriginalsSchema.safeParse({
    brandId: input.brandId,
    files: input.files.map((file) => ({
      name: file.name,
      contentType: file.contentType,
      chars: file.chars,
      encrypted: file.encrypted,
      ...(file.byteSize === undefined ? {} : { byteSize: file.byteSize }),
      pages: file.pages,
    })),
  });
  if (!parsed.success || parsed.data.files.length !== input.files.length) return denied("INVALID_INPUT");
  const drafts: SourceDraft[] = [];
  for (let index = 0; index < parsed.data.files.length; index += 1) {
    const fields = parsed.data.files[index];
    const body = input.files[index]?.body;
    if (!fields || !(body instanceof Uint8Array)) return denied("INVALID_INPUT");
    drafts.push({ ...fields, body });
  }
  const classified = classifySourceImport(drafts);
  const now = (options.now ?? new Date()).toISOString();
  const batchId = randomUUID();

  return db.transaction(async (tx) => {
    if (!await new BrandDao(tx).lockOwner(ownerId)) return denied("NOT_FOUND");
    if (!await openBrand(tx, ownerId, parsed.data.brandId)) return denied("NOT_FOUND");
    const rows: SourceOriginalInsert[] = [];
    for (const file of classified.files) {
      let storedObjectId: string | null = null;
      let status = file.status;
      let reason = file.reason;
      if (file.write && file.body && file.contentType) {
        const saved = await saveStoredObject(db, {
          actorId: ownerId,
          brandId: parsed.data.brandId,
          class: "source-original",
          visibility: "internal",
          fileName: file.fileName,
          contentType: file.contentType,
          body: file.body,
        }, { ...storageOptions(options), connection: tx });
        const digest = createHash("sha256").update(file.body).digest("hex");
        const matches = saved.ok
          && saved.class === "source-original"
          && saved.visibility === "internal"
          && saved.fileName === file.fileName
          && saved.contentType === file.contentType
          && saved.byteSize === file.body.byteLength
          && saved.sha256 === digest;
        if (!matches) {
          if (saved.ok) await markObjectFailed(tx, saved.id, ownerId, "ready");
          storedObjectId = null;
          status = "failed";
          reason = !saved.ok && saved.code === "capacity" ? "capacity" : "unavailable";
        } else {
          storedObjectId = saved.id;
        }
      }
      rows.push({
        id: randomUUID(),
        brandId: parsed.data.brandId,
        ownerId,
        batchId,
        fileName: file.fileName,
        byteSize: file.byteSize,
        storedObjectId,
        status,
        reason,
        rightsStatus: "active",
        createdAt: now,
      });
    }
    await insertSourceOriginals(tx, rows);
    return {
      batchId,
      factsApproved: classified.factsApproved,
      files: rows.map((row) => ({
        id: row.id,
        fileName: row.fileName,
        byteSize: row.byteSize,
        storedObjectId: row.storedObjectId,
        status: row.status,
        reason: row.reason,
        rightsStatus: row.rightsStatus,
      })),
    };
  });
}

export async function listImportedOriginals(db: DatabaseConnection, ownerId: string, brandId: string) {
  const parsed = brandIdSchema.safeParse(brandId);
  if (!parsed.success) return denied("INVALID_INPUT");
  const brand = await brandOwnedBy(db, ownerId, parsed.data);
  if (!brand) return denied("NOT_FOUND");
  return { files: await listSourceOriginals(db, ownerId, parsed.data, listLimit) };
}

export async function setSourceOriginalRights(
  db: DatabaseConnection,
  ownerId: string,
  input: { brandId: string; id: string; rights: "revoked" | "expired" },
) {
  const parsed = setSourceRightsSchema.safeParse(input);
  if (!parsed.success) return denied("INVALID_INPUT");
  return db.transaction(async (tx) => {
    if (!await new BrandDao(tx).lockOwner(ownerId)) return denied("NOT_FOUND");
    if (!await openBrand(tx, ownerId, parsed.data.brandId)) return denied("NOT_FOUND");
    const file = await writeRights(tx, ownerId, parsed.data.brandId, parsed.data.id, parsed.data.rights);
    if (!file) return denied("NOT_FOUND");
    return { file };
  });
}

async function linkedOriginal(db: DatabaseConnection, ownerId: string, brandId: string, id: string) {
  if (!await openBrand(db, ownerId, brandId)) return null;
  const row = await loadSourceOriginal(db, ownerId, brandId, id);
  if (!row?.storedObjectId) return null;
  return row;
}

export async function readSourceOriginal(
  db: DatabaseConnection,
  ownerId: string,
  input: { brandId: string; id: string },
  options: SourceCommandOptions = {},
) {
  const parsed = readSourceOriginalSchema.safeParse(input);
  if (!parsed.success) return denied("INVALID_INPUT");
  const row = await linkedOriginal(db, ownerId, parsed.data.brandId, parsed.data.id);
  if (!row?.storedObjectId) return denied("NOT_FOUND");
  const loaded = await readStoredObject(db, { actorId: ownerId, objectId: row.storedObjectId }, storageOptions(options));
  if (!loaded.ok) return denied(loaded.code === "failed" ? "SERVICE_UNAVAILABLE" : "NOT_FOUND");
  return {
    id: row.id,
    fileName: loaded.fileName,
    contentType: loaded.contentType,
    byteSize: loaded.byteSize,
    sha256: loaded.sha256,
    body: loaded.body,
  };
}

export async function presignSourceOriginal(
  db: DatabaseConnection,
  ownerId: string,
  input: { brandId: string; id: string },
  options: SourceCommandOptions = {},
) {
  const parsed = readSourceOriginalSchema.safeParse(input);
  if (!parsed.success) return denied("INVALID_INPUT");
  const row = await linkedOriginal(db, ownerId, parsed.data.brandId, parsed.data.id);
  if (!row?.storedObjectId) return denied("NOT_FOUND");
  const signed = await presignStoredObject(db, { actorId: ownerId, objectId: row.storedObjectId }, storageOptions(options));
  if (!signed.ok) return denied(signed.code === "failed" ? "SERVICE_UNAVAILABLE" : "NOT_FOUND");
  return { id: row.id, url: signed.url, expiresInSeconds: signed.expiresInSeconds };
}

export type { SourceOriginalRow };
