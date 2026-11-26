import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { factFields } from "../brand-facts/contracts.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { BrandDao } from "../brands/dao.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";
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
  type SourceFragmentView,
} from "./contracts.ts";
import {
  brandOwnedBy,
  insertSourceFragmentConflicts,
  insertSourceFragments,
  insertSourceOriginals,
  listApprovedFactContents,
  listBrandSourceOriginals,
  listSourceFragmentConflicts,
  listSourceFragments,
  listSourceOriginals,
  loadSourceOriginal,
  setSourceOriginalRights as writeRights,
  sourceAccessFor,
  type SourceFragmentConflictInsert,
  type SourceFragmentInsert,
  type SourceOriginalInsert,
  type SourceOriginalRow,
} from "./dao.ts";
import { fragmentCandidates, type ApprovedFactRef } from "./rules.ts";

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

async function approvedFactRefs(db: QueryConnection, brandId: string) {
  const rows = await listApprovedFactContents(db, brandId);
  const facts: ApprovedFactRef[] = [];
  for (const row of rows) {
    let content: unknown;
    try {
      content = JSON.parse(row.content);
    } catch {
      continue;
    }
    const parsed = factFields.safeParse(content);
    if (parsed.success) facts.push({ id: row.id, version: row.version, claim: parsed.data.claim });
  }
  return facts;
}

function presentFragments(
  rights: SourceOriginalRow["rightsStatus"],
  fragments: readonly { id: string; ordinal: number; page: number | null; text: string | null; conflicts: SourceFragmentView["conflicts"] }[],
): SourceFragmentView[] {
  const readable = rights === "active";
  return fragments.map((fragment) => ({
    id: fragment.id,
    ordinal: fragment.ordinal,
    page: fragment.page,
    text: readable ? fragment.text : null,
    readable,
    approved: false,
    conflicts: fragment.conflicts,
  }));
}

function canManageOriginals(brand: Awaited<ReturnType<typeof brandOwnedBy>>) {
  return brand?.status === "active" && brand.frozenAt === null;
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
    if (!canManageOriginals(await brandOwnedBy(tx, ownerId, parsed.data.brandId))) return denied("NOT_FOUND");
    const facts = await approvedFactRefs(tx, parsed.data.brandId);
    const rows: SourceOriginalInsert[] = [];
    const fragmentRows: SourceFragmentInsert[] = [];
    const conflictRows: SourceFragmentConflictInsert[] = [];
    const fragmentsBySource = new Map<string, SourceFragmentView[]>();
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
      const id = randomUUID();
      const kept = status === "ready" || status === "partial" ? file.pages : [];
      const candidates = fragmentCandidates(kept, facts);
      const views: SourceFragmentView[] = candidates.map((candidate) => {
        const fragmentId = randomUUID();
        fragmentRows.push({
          id: fragmentId,
          sourceOriginalId: id,
          brandId: parsed.data.brandId,
          ownerId,
          ordinal: candidate.ordinal,
          page: candidate.page,
          excerpt: candidate.text,
          createdAt: now,
        });
        for (const conflict of candidate.conflicts) {
          conflictRows.push({
            fragmentId,
            brandId: parsed.data.brandId,
            factVersionId: conflict.factVersionId,
            factVersion: conflict.version,
          });
        }
        return {
          id: fragmentId,
          ordinal: candidate.ordinal,
          page: candidate.page,
          text: candidate.text,
          readable: true,
          approved: false,
          conflicts: candidate.conflicts,
        };
      });
      rows.push({
        id,
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
      fragmentsBySource.set(id, views);
    }
    await insertSourceOriginals(tx, rows);
    await insertSourceFragments(tx, fragmentRows);
    await insertSourceFragmentConflicts(tx, conflictRows);
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
        fragments: fragmentsBySource.get(row.id) ?? [],
      })),
    };
  });
}

async function withFragments(db: QueryConnection, brandId: string, files: readonly SourceOriginalRow[]) {
  const fragments = await listSourceFragments(db, brandId, files.map((file) => file.id));
  const conflicts = await listSourceFragmentConflicts(db, brandId, fragments.map((fragment) => fragment.id));
  const conflictsByFragment = new Map<string, SourceFragmentView["conflicts"]>();
  for (const conflict of conflicts) {
    const current = conflictsByFragment.get(conflict.fragmentId) ?? [];
    current.push({ factVersionId: conflict.factVersionId, version: conflict.factVersion });
    conflictsByFragment.set(conflict.fragmentId, current);
  }
  const bySource = new Map<string, SourceFragmentView[]>();
  for (const fragment of fragments) {
    const current = bySource.get(fragment.sourceId) ?? [];
    current.push({
      id: fragment.id,
      ordinal: fragment.ordinal,
      page: fragment.page,
      text: fragment.excerpt,
      readable: true,
      approved: false,
      conflicts: conflictsByFragment.get(fragment.id) ?? [],
    });
    bySource.set(fragment.sourceId, current);
  }
  return files.map((file) => ({
    ...file,
    fragments: presentFragments(file.rightsStatus, bySource.get(file.id) ?? []),
  }));
}

export async function listImportedOriginals(db: DatabaseConnection, userId: string, brandId: string, now = new Date()) {
  const parsed = brandIdSchema.safeParse(brandId);
  if (!parsed.success) return denied("INVALID_INPUT");
  const access = await sourceAccessFor(db, userId, parsed.data, now.toISOString());
  if (!access) return denied("NOT_FOUND");
  const { viewer, owned } = access;
  const files = viewer === "owner"
    ? await listSourceOriginals(db, userId, parsed.data, listLimit)
    : await listBrandSourceOriginals(db, parsed.data, listLimit);
  return {
    viewer,
    canManage: canManageOriginals(owned),
    files: await withFragments(db, parsed.data, files),
  };
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
    if (!canManageOriginals(await brandOwnedBy(tx, ownerId, parsed.data.brandId))) return denied("NOT_FOUND");
    const file = await writeRights(tx, ownerId, parsed.data.brandId, parsed.data.id, parsed.data.rights);
    if (!file) return denied("NOT_FOUND");
    return { file };
  });
}

async function linkedOriginal(db: DatabaseConnection, actorId: string, brandId: string, id: string) {
  const scope = await authorizeBrandActor(db, actorId, brandId, "download");
  if (!scope) return null;
  const row = await loadSourceOriginal(db, scope.ownerId, brandId, id);
  if (!row?.storedObjectId) return null;
  return { row, ownerId: scope.ownerId };
}

export async function readSourceOriginal(
  db: DatabaseConnection,
  ownerId: string,
  input: { brandId: string; id: string },
  options: SourceCommandOptions = {},
) {
  const parsed = readSourceOriginalSchema.safeParse(input);
  if (!parsed.success) return denied("INVALID_INPUT");
  const found = await linkedOriginal(db, ownerId, parsed.data.brandId, parsed.data.id);
  if (!found) return denied("NOT_FOUND");
  const { row, ownerId: brandOwnerId } = found;
  if (!row.storedObjectId) return denied("NOT_FOUND");
  const loaded = await readStoredObject(db, { actorId: brandOwnerId === ownerId ? ownerId : ownerId, objectId: row.storedObjectId }, storageOptions(options));
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
  const found = await linkedOriginal(db, ownerId, parsed.data.brandId, parsed.data.id);
  if (!found) return denied("NOT_FOUND");
  const { row } = found;
  if (!row.storedObjectId) return denied("NOT_FOUND");
  const signed = await presignStoredObject(db, { actorId: ownerId, objectId: row.storedObjectId }, storageOptions(options));
  if (!signed.ok) return denied(signed.code === "failed" ? "SERVICE_UNAVAILABLE" : "NOT_FOUND");
  return { id: row.id, url: signed.url, expiresInSeconds: signed.expiresInSeconds };
}

export type { SourceOriginalRow };
