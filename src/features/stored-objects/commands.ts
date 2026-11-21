import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { queryWithParameters, type DatabaseConnection, type QueryConnection } from "../../lib/db/connection.ts";
import {
  createObjectStorage,
  parseStorageEnvironment,
  type PresignGetInput,
  type StorageFailure,
  type StoredObject as WrittenObject,
  type WriteFailure,
  type WriteObjectInput,
} from "../../lib/storage/index.ts";
import {
  buildObjectKey,
  contentTypeAllowed,
  immutableForClass,
  listStoredObjectsSchema,
  objectByteLimit,
  presignStoredObjectSchema,
  readStoredObjectSchema,
  sanitizeObjectFileName,
  saveStoredObjectSchema,
  scopeAllowed,
  visibilityAllowed,
  type ListStoredObjectsInput,
  type ObjectClass,
  type PresignStoredObjectInput,
  type ReadStoredObjectInput,
  type SaveStoredObjectInput,
} from "./contracts.ts";
import { sourceOriginalMayDownload } from "../asset-reuse/dao.ts";
import {
  claimMutableObject,
  insertPendingObject,
  listFailedObjectKeys,
  listStoredObjectsForOwner,
  loadOwnedObject,
  markObjectFailed,
  markObjectReady,
  ownedExportIsCurrent,
  type ListedStoredObject,
  type PendingObjectInsert,
  type StoredObjectRow,
} from "./dao.ts";

const CLEANUP_BATCH = 20;

export type ObjectStorageClient = {
  putAndReadBack(input: WriteObjectInput): Promise<WrittenObject | WriteFailure>;
  getObject(input: { key: string }): Promise<{ ok: true; body: Uint8Array; byteSize: number; sha256: string } | StorageFailure>;
  deleteObject(input: { key: string }): Promise<{ ok: true } | StorageFailure>;
  presignGet(input: PresignGetInput): Promise<{ ok: true; url: string; expiresInSeconds: number } | StorageFailure>;
};

export type StoredObjectFailureCode = "rejected" | "not-found" | "immutable" | "failed";
export type StoredObjectFailure = { ok: false; code: StoredObjectFailureCode };

export type ReadyStoredObject = {
  ok: true;
  status: "ready";
  id: string;
  class: ObjectClass;
  visibility: "internal" | "public";
  contentType: string;
  byteSize: number;
  sha256: string;
  fileName: string;
};

export type StoredObjectRead = ReadyStoredObject & { body: Uint8Array };
export type StoredObjectPresign = {
  ok: true;
  status: "ready";
  id: string;
  url: string;
  expiresInSeconds: number;
};
export type StoredObjectList = { ok: true; objects: ListedStoredObject[] };

type CommandOptions = {
  env?: Record<string, string | undefined>;
  storage?: ObjectStorageClient;
  now?: Date;
  /** Reuse an open transaction instead of starting one. Avoids nested BEGIN on SQLite. */
  connection?: QueryConnection;
};

function metadataDb(db: DatabaseConnection, options: CommandOptions): QueryConnection {
  return options.connection ?? db;
}

function metadataWrite<T>(
  db: DatabaseConnection,
  options: CommandOptions,
  work: (connection: QueryConnection) => Promise<T>,
) {
  return options.connection ? work(options.connection) : db.transaction(work);
}

function failure(code: StoredObjectFailureCode): StoredObjectFailure {
  return { ok: false, code };
}

function sha256Hex(body: Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}

function storageFor(options: CommandOptions) {
  return options.storage ?? createObjectStorage(options.env ? { env: options.env } : {});
}

function environment(options: CommandOptions) {
  return parseStorageEnvironment(options.env ?? process.env);
}

async function brandIsOpen(db: QueryConnection, actorId: string, brandId: string) {
  const rows = await queryWithParameters(
    db,
    "SELECT id FROM brand WHERE id = ? AND owner_id = ? AND frozen_at IS NULL",
    [brandId, actorId],
  );
  return rows.length === 1;
}

function isFailure(value: StoredObjectRow | StoredObjectFailure): value is StoredObjectFailure {
  return "code" in value;
}

function browserUrlMatches(url: string, browserEndpoint: string, serverEndpoint: string) {
  const actual = URL.parse(url);
  const browser = URL.parse(browserEndpoint);
  if (!actual || !browser) return false;
  if (actual.protocol !== browser.protocol || actual.port !== browser.port) return false;
  const hostOk = actual.hostname === browser.hostname || actual.hostname.endsWith(`.${browser.hostname}`);
  if (!hostOk) return false;
  const server = URL.parse(serverEndpoint);
  if (server && browser.hostname !== server.hostname && (actual.hostname === server.hostname || actual.hostname.endsWith(`.${server.hostname}`))) {
    return false;
  }
  return true;
}

async function authorizeBrand(db: QueryConnection, actorId: string, className: ObjectClass, brandId: string | null) {
  if (!scopeAllowed(className, brandId)) return failure("rejected");
  if (brandId === null) return null;
  return await brandIsOpen(db, actorId, brandId) ? null : failure("not-found");
}

async function retryFailedCleanup(db: QueryConnection, storage: ObjectStorageClient, ownerId: string, brandId: string | null) {
  const keys = await listFailedObjectKeys(db, ownerId, brandId, CLEANUP_BATCH);
  for (const key of keys) {
    await storage.deleteObject({ key });
  }
}

function readyResult(row: { id: string; class: ObjectClass; visibility: "internal" | "public"; contentType: string; byteSize: number; sha256: string; fileName: string }): ReadyStoredObject {
  return {
    ok: true,
    status: "ready",
    id: row.id,
    class: row.class,
    visibility: row.visibility,
    contentType: row.contentType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    fileName: row.fileName,
  };
}

async function openReadyObject(db: QueryConnection, actorId: string, objectId: string): Promise<StoredObjectRow | StoredObjectFailure> {
  const row = await loadOwnedObject(db, actorId, objectId);
  if (!row || row.status !== "ready" || !row.objectKey || !row.fileName) return failure("not-found");
  if (row.class === "owned-export" && !await ownedExportIsCurrent(db, actorId, row.id)) return failure("not-found");
  if (row.brandId !== null && !await brandIsOpen(db, actorId, row.brandId)) return failure("not-found");
  if (row.class === "source-original" && !await sourceOriginalMayDownload(db, actorId, row.id)) return failure("not-found");
  return row;
}

export async function saveStoredObject(
  db: DatabaseConnection,
  input: SaveStoredObjectInput & { body: Uint8Array },
  options: CommandOptions = {},
): Promise<ReadyStoredObject | StoredObjectFailure> {
  const { body, ...fields } = input;
  const parsed = saveStoredObjectSchema.safeParse(fields);
  if (!parsed.success || !(body instanceof Uint8Array)) return failure("rejected");
  const command = parsed.data;
  const fileName = sanitizeObjectFileName(command.fileName);
  if (!fileName) return failure("rejected");
  if (!visibilityAllowed(command.class, command.visibility)) return failure("rejected");
  if (!contentTypeAllowed(command.class, command.contentType)) return failure("rejected");
  if (body.byteLength < 1 || body.byteLength > objectByteLimit(command.class)) return failure("rejected");
  const scopeDb = metadataDb(db, options);
  const scope = await authorizeBrand(scopeDb, command.actorId, command.class, command.brandId);
  if (scope) return scope;

  const config = environment(options);
  if (!config.success) return failure("failed");
  const storage = storageFor(options);
  const now = (options.now ?? new Date()).toISOString();
  const digest = sha256Hex(body);
  let objectId = command.objectId ?? randomUUID();
  let objectKey = buildObjectKey({
    ownerId: command.actorId,
    brandId: command.brandId,
    class: command.class,
    objectId,
    fileName,
  });
  if (!objectKey) return failure("rejected");
  await retryFailedCleanup(scopeDb, storage, command.actorId, command.brandId);

  if (command.objectId) {
    const current = await loadOwnedObject(scopeDb, command.actorId, command.objectId);
    if (!current || current.brandId !== command.brandId || current.class !== command.class || current.status === "tombstoned") {
      return failure("not-found");
    }
    if (current.visibility !== command.visibility || current.fileName !== fileName) return failure("rejected");
    if (current.status === "ready" && current.immutable === 1) return failure("immutable");
    objectId = current.id;
    objectKey = current.objectKey ?? "";
    if (!objectKey) return failure("not-found");
  }

  const pending: PendingObjectInsert = {
    id: objectId,
    ownerId: command.actorId,
    brandId: command.brandId,
    class: command.class,
    visibility: command.visibility,
    bucket: config.data.bucket,
    objectKey,
    contentType: command.contentType,
    byteSize: body.byteLength,
    sha256: digest,
    fileName,
    immutable: immutableForClass(command.class),
    createdAt: now,
  };

  if (command.objectId) {
    const claimed = await metadataWrite(db, options, (tx) => claimMutableObject(tx, pending));
    if (!claimed) {
      const current = await loadOwnedObject(scopeDb, command.actorId, objectId);
      if (current?.status === "ready" && current.immutable === 1) return failure("immutable");
      return failure("not-found");
    }
  } else {
    await metadataWrite(db, options, (tx) => insertPendingObject(tx, pending));
  }

  let written: WrittenObject | WriteFailure;
  try {
    written = await storage.putAndReadBack({ key: objectKey, body, contentType: command.contentType });
  } catch {
    await metadataWrite(db, options, (tx) => markObjectFailed(tx, objectId, command.actorId, "pending"));
    return failure("failed");
  }

  if (!written.ok
    || written.sha256 !== digest
    || written.byteSize !== body.byteLength
    || written.key !== objectKey
    || written.bucket !== config.data.bucket) {
    if (written.ok) await storage.deleteObject({ key: objectKey });
    await metadataWrite(db, options, (tx) => markObjectFailed(tx, objectId, command.actorId, "pending"));
    return failure("failed");
  }

  const ready = await metadataWrite(db, options, (tx) => markObjectReady(tx, {
    id: objectId,
    ownerId: command.actorId,
    byteSize: written.byteSize,
    sha256: written.sha256,
    readyAt: now,
  }));
  if (!ready) {
    await storage.deleteObject({ key: objectKey });
    await metadataWrite(db, options, (tx) => markObjectFailed(tx, objectId, command.actorId, "pending"));
    return failure("failed");
  }

  return readyResult({
    id: objectId,
    class: command.class,
    visibility: command.visibility,
    contentType: command.contentType,
    byteSize: written.byteSize,
    sha256: written.sha256,
    fileName,
  });
}

export async function readStoredObject(
  db: DatabaseConnection,
  input: ReadStoredObjectInput,
  options: CommandOptions = {},
): Promise<StoredObjectRead | StoredObjectFailure> {
  const parsed = readStoredObjectSchema.safeParse(input);
  if (!parsed.success) return failure("rejected");
  const opened = await openReadyObject(db, parsed.data.actorId, parsed.data.objectId);
  if (isFailure(opened) || opened.status !== "ready" || !opened.objectKey || !opened.fileName) {
    return isFailure(opened) ? opened : failure("not-found");
  }
  const storage = storageFor(options);
  let loaded: Awaited<ReturnType<ObjectStorageClient["getObject"]>>;
  try {
    loaded = await storage.getObject({ key: opened.objectKey });
  } catch {
    return failure("failed");
  }
  if (!loaded.ok) return failure("failed");
  if (loaded.sha256 !== opened.sha256 || loaded.byteSize !== opened.byteSize) {
    await storage.deleteObject({ key: opened.objectKey });
    await db.transaction((tx) => markObjectFailed(tx, opened.id, opened.ownerId, "ready"));
    return failure("failed");
  }
  return { ...readyResult({ ...opened, fileName: opened.fileName }), body: loaded.body };
}

export async function presignStoredObject(
  db: DatabaseConnection,
  input: PresignStoredObjectInput,
  options: CommandOptions = {},
): Promise<StoredObjectPresign | StoredObjectFailure> {
  const parsed = presignStoredObjectSchema.safeParse(input);
  if (!parsed.success) return failure("rejected");
  const opened = await openReadyObject(db, parsed.data.actorId, parsed.data.objectId);
  if (isFailure(opened) || opened.status !== "ready" || !opened.objectKey || !opened.fileName) {
    return isFailure(opened) ? opened : failure("not-found");
  }
  // Owned exports and publication screenshots are downloaded through the app after a fresh
  // authorization check. A storage URL must not stand in for that check.
  if (opened.class === "owned-export" || opened.class === "publication-evidence") return failure("not-found");
  const config = environment(options);
  if (!config.success || !config.data.browserEndpoint || config.data.browserEndpointInvalid) return failure("failed");
  const storage = storageFor(options);
  let signed: Awaited<ReturnType<ObjectStorageClient["presignGet"]>>;
  try {
    signed = await storage.presignGet({
      key: opened.objectKey,
      contentType: opened.contentType,
      fileName: opened.fileName,
      expiresInSeconds: parsed.data.expiresInSeconds,
    });
  } catch {
    return failure("failed");
  }
  if (!signed.ok || signed.expiresInSeconds < 1 || signed.expiresInSeconds > 900) return failure("failed");
  if (!browserUrlMatches(signed.url, config.data.browserEndpoint, config.data.endpoint)) return failure("failed");
  const expires = URL.parse(signed.url)?.searchParams.get("X-Amz-Expires");
  if (expires !== null && expires !== undefined && Number(expires) > 900) return failure("failed");
  return { ok: true, status: "ready", id: opened.id, url: signed.url, expiresInSeconds: signed.expiresInSeconds };
}

export async function listStoredObjects(
  db: DatabaseConnection,
  input: ListStoredObjectsInput,
): Promise<StoredObjectList | StoredObjectFailure> {
  const parsed = listStoredObjectsSchema.safeParse(input);
  if (!parsed.success) return failure("rejected");
  const scope = await authorizeBrand(db, parsed.data.actorId, parsed.data.class, parsed.data.brandId);
  if (scope) return scope;
  const objects = await listStoredObjectsForOwner(db, {
    ownerId: parsed.data.actorId,
    brandId: parsed.data.brandId,
    class: parsed.data.class,
    limit: parsed.data.limit,
  });
  return { ok: true, objects };
}
