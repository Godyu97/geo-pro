import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { exportFileName, exportRequestSchema } from "../../src/features/data-exports/contracts.ts";
import { exportSectionBytes } from "../../src/features/data-exports/sections.ts";
import {
  prepareExport,
  readExportFile,
  readOwnedExportByObject,
} from "../../src/features/data-exports/service.ts";
import { presignStoredObject, readStoredObject, saveStoredObject } from "../../src/features/stored-objects/commands.ts";
import { MAX_OWNED_EXPORT_BYTES } from "../../src/features/stored-objects/contracts.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-21T10:00:00.000Z";
const storageEnv = {
  S3_ENDPOINT: "http://127.0.0.1:9",
  S3_REGION: "us-east-1",
  S3_BUCKET: "app-files",
  S3_ACCESS_KEY_ID: "local-app",
  S3_SECRET_ACCESS_KEY: "s3-secret-not-for-logs",
  S3_FORCE_PATH_STYLE: "true",
};

function memoryStorage() {
  const objects = new Map();
  const calls = { put: 0, get: 0, presign: 0 };
  return {
    objects,
    calls,
    async putAndReadBack({ key, body, contentType }) {
      calls.put += 1;
      const copy = Uint8Array.from(body);
      objects.set(key, copy);
      return {
        ok: true,
        status: "ready",
        bucket: "app-files",
        key,
        byteSize: copy.byteLength,
        sha256: createHash("sha256").update(copy).digest("hex"),
        contentType,
      };
    },
    async getObject({ key }) {
      calls.get += 1;
      const body = objects.get(key);
      if (!body) return { ok: false, status: "failed", code: "unavailable" };
      return { ok: true, body, byteSize: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") };
    },
    async deleteObject({ key }) {
      objects.delete(key);
      return { ok: true };
    },
    async presignGet() {
      calls.presign += 1;
      return { ok: false, status: "failed", code: "unavailable" };
    },
  };
}

function failingStorage() {
  return {
    async putAndReadBack() {
      return { ok: false, status: "failed", code: "unavailable" };
    },
    async getObject() {
      throw new Error("denied export download must not read object bytes");
    },
    async deleteObject() {
      return { ok: true };
    },
    async presignGet() {
      throw new Error("owned export must not be presigned");
    },
  };
}

function request(actorId, scopes, previousId = null, locale = "zh-CN") {
  return exportRequestSchema.parse({ actorId, scopes, previousId, locale });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("owned export keeps the 8 MiB ceiling", () => {
  assert.equal(exportSectionBytes, 8 * 1024 * 1024);
  assert.equal(MAX_OWNED_EXPORT_BYTES, exportSectionBytes);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: owned export bytes are stored and old object ids cannot be downloaded`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const storage = memoryStorage();
    const options = { env: storageEnv, storage, now: new Date(time) };
    const owner = randomUUID();
    const other = randomUUID();
    await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [owner, "导出主人", "owner@example.invalid"]);
    await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [other, "其他账号", "other@example.invalid"]);

    const prepared = await prepareExport(db, owner, request(owner, ["profile"]), options);
    assert.equal(prepared.error, undefined);
    const summary = prepared.summary;
    assert.equal(summary.status, "ready");
    assert.equal(summary.locale, "zh-CN");
    const [row] = await queryWithParameters(
      db,
      `SELECT object_id AS "objectId", fingerprint FROM user_data_export WHERE owner_id = ? AND id = ?`,
      [owner, summary.id],
    );
    assert.match(row.objectId, /^[0-9a-f-]{36}$/);
    const [object] = await queryWithParameters(
      db,
      `SELECT "class" AS "class", visibility, immutable, status, content_type AS "contentType",
        file_name AS "fileName", sha256, object_key AS "objectKey", brand_id AS "brandId"
       FROM stored_object WHERE id = ? AND owner_id = ?`,
      [row.objectId, owner],
    );
    assert.equal(object.class, "owned-export");
    assert.equal(object.visibility, "internal");
    assert.equal(Number(object.immutable), 1);
    assert.equal(object.status, "ready");
    assert.equal(object.contentType, "application/json");
    assert.equal(object.brandId, null);
    assert.equal(object.fileName, exportFileName(summary));
    assert.match(object.fileName, /个人数据/);
    assert.match(object.objectKey, new RegExp(`/account/owned-export/${row.objectId}/`));
    const file = await readExportFile(db, owner, summary.id, false, options);
    assert.equal(file.error, undefined);
    const parsed = JSON.parse(file.body);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.locale, "zh-CN");
    assert.deepEqual(parsed.data.profile, { name: "导出主人", email: "owner@example.invalid" });
    assert.equal(sha256(file.body), object.sha256);
    assert.equal(sha256(JSON.stringify([1, parsed.data])), row.fingerprint);
    assert.equal(file.body.includes("X-Amz-"), false);
    const firstBytes = new Map([...storage.objects.entries()].map(([key, body]) => [key, Uint8Array.from(body)]));

    const puts = storage.calls.put;
    const overwrite = await saveStoredObject(db, {
      actorId: owner,
      brandId: null,
      class: "owned-export",
      visibility: "internal",
      fileName: object.fileName,
      contentType: "application/json",
      objectId: row.objectId,
      body: new TextEncoder().encode("{\"replaced\":true}"),
    }, options);
    assert.equal(overwrite.ok, false);
    assert.equal(overwrite.code, "immutable");
    assert.equal(storage.calls.put, puts);

    const oversized = await saveStoredObject(db, {
      actorId: owner,
      brandId: null,
      class: "owned-export",
      visibility: "internal",
      fileName: "too-big.json",
      contentType: "application/json",
      body: new Uint8Array(MAX_OWNED_EXPORT_BYTES + 1),
    }, options);
    assert.equal(oversized.ok, false);
    assert.equal(oversized.code, "rejected");
    assert.equal(storage.calls.put, puts);

    await queryWithParameters(db, 'UPDATE "user" SET name = ? WHERE id = ?', ["改名后的主人", owner]);
    const getsBeforeDrift = storage.calls.get;
    assert.equal(await readExportFile(db, owner, summary.id, false, {
      env: storageEnv,
      storage: failingStorage(),
      now: new Date(time),
    }), null);
    assert.equal(await readOwnedExportByObject(db, owner, row.objectId, false, {
      env: storageEnv,
      storage: failingStorage(),
      now: new Date(time),
    }), null);
    assert.equal(storage.calls.get, getsBeforeDrift);
    await queryWithParameters(db, 'UPDATE "user" SET name = ? WHERE id = ?', ["导出主人", owner]);

    const renewed = await prepareExport(db, owner, request(owner, ["profile"], summary.id, "en"), options);
    assert.equal(renewed.error, undefined);
    assert.notEqual(renewed.summary.id, summary.id);
    const [next] = await queryWithParameters(
      db,
      `SELECT object_id AS "objectId" FROM user_data_export WHERE owner_id = ?`,
      [owner],
    );
    assert.notEqual(next.objectId, row.objectId);
    assert.match(exportFileName(renewed.summary), /personal-data/);
    for (const [key, body] of firstBytes) assert.deepEqual(storage.objects.get(key), body);
    const current = await readExportFile(db, owner, renewed.summary.id, false, options);
    assert.equal(JSON.parse(current.body).locale, "en");
    const deniedOptions = { env: storageEnv, storage: failingStorage(), now: new Date(time) };
    assert.equal(await readExportFile(db, owner, summary.id, false, deniedOptions), null);
    assert.equal(await readOwnedExportByObject(db, owner, row.objectId, false, deniedOptions), null);
    assert.equal(await readExportFile(db, other, renewed.summary.id, false, deniedOptions), null);
    assert.equal(await readOwnedExportByObject(db, other, next.objectId, false, deniedOptions), null);
    assert.equal(await readOwnedExportByObject(db, owner, randomUUID(), false, deniedOptions), null);
    const generic = await readStoredObject(db, { actorId: owner, objectId: row.objectId }, deniedOptions);
    assert.deepEqual(generic, { ok: false, code: "not-found" });
    const signed = await presignStoredObject(db, { actorId: owner, objectId: next.objectId }, deniedOptions);
    assert.deepEqual(signed, { ok: false, code: "not-found" });
    assert.equal(JSON.stringify(signed).includes("http"), false);
    assert.equal(storage.calls.presign, 0);

    const failed = await prepareExport(db, owner, request(owner, ["profile"], renewed.summary.id), {
      env: storageEnv,
      storage: failingStorage(),
      now: new Date(time),
    });
    assert.deepEqual(failed, { error: "SERVICE_UNAVAILABLE" });
    const [still] = await queryWithParameters(db, `SELECT id FROM user_data_export WHERE owner_id = ?`, [owner]);
    assert.equal(still.id, renewed.summary.id);
    for (const [key, body] of firstBytes) assert.deepEqual(storage.objects.get(key), body);

    await queryWithParameters(db, "UPDATE user_data_export SET object_id = NULL WHERE owner_id = ?", [owner]);
    const historical = await readExportFile(db, owner, renewed.summary.id, false, deniedOptions);
    assert.equal(historical.error, undefined);
    assert.equal(JSON.parse(historical.body).locale, "en");

    await queryWithParameters(db, 'DELETE FROM "user" WHERE id = ?', [owner]);
    assert.equal(await readExportFile(db, owner, renewed.summary.id, false, deniedOptions), null);
    assert.equal(await readOwnedExportByObject(db, owner, next.objectId, false, deniedOptions), null);
    const orphan = await readStoredObject(db, { actorId: owner, objectId: next.objectId }, deniedOptions);
    assert.deepEqual(orphan, { ok: false, code: "not-found" });
  });
}
