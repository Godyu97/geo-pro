import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { importSourceOriginals } from "../../src/features/asset-reuse/commands.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { saveStoredObject } from "../../src/features/stored-objects/commands.ts";
import { markObjectFailed, setBrandStorageLimit } from "../../src/features/stored-objects/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-24T01:02:03.000Z";
const now = new Date(time);
const storageEnv = {
  S3_ENDPOINT: "http://127.0.0.1:9",
  S3_ENDPOINT_BROWSER: "http://192.0.2.10:8333",
  S3_REGION: "us-east-1",
  S3_BUCKET: "app-files",
  S3_ACCESS_KEY_ID: "local-app",
  S3_SECRET_ACCESS_KEY: "s3-secret-not-for-logs",
  S3_FORCE_PATH_STYLE: "true",
};
const brandFields = {
  name: "容量品牌",
  description: "Synthetic brand for storage capacity",
  website: "https://capacity.example.com",
  aliases: [],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};
const liveBytesSql = `SELECT coalesce(sum(byte_size), 0) AS used FROM stored_object
  WHERE brand_id = ? AND status IN ('pending', 'ready') AND deleted_at IS NULL`;

function textFile(name, text) {
  return {
    name,
    contentType: "text/plain",
    chars: [...text].length,
    encrypted: false,
    pages: [{ page: 1, text }],
    body: new TextEncoder().encode(text),
  };
}

function memoryStorage() {
  const objects = new Map();
  const calls = { put: 0 };
  return {
    calls,
    async putAndReadBack({ key, body, contentType }) {
      calls.put += 1;
      const sha256 = createHash("sha256").update(body).digest("hex");
      objects.set(key, body);
      return { ok: true, status: "ready", bucket: "app-files", key, byteSize: body.byteLength, sha256, contentType };
    },
    async getObject({ key }) {
      const stored = objects.get(key);
      if (!stored) return { ok: false, status: "failed", code: "unavailable" };
      return { ok: true, body: stored, byteSize: stored.byteLength, sha256: createHash("sha256").update(stored).digest("hex") };
    },
    async deleteObject() {
      return { ok: true };
    },
    async presignGet() {
      return { ok: false, status: "failed", code: "unavailable" };
    },
  };
}

function asCount(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  throw new Error("Unexpected byte total");
}

async function liveBytes(db, brandId) {
  const [row] = await queryWithParameters(db, liveBytesSql, [brandId]);
  return asCount(row.used);
}

async function objectRows(db, brandId) {
  const rows = await queryWithParameters(
    db,
    `SELECT id, status, byte_size AS "byteSize", sha256, deleted_at AS "deletedAt"
     FROM stored_object WHERE brand_id = ? ORDER BY created_at, id`,
    [brandId],
  );
  return rows.map((row) => ({ ...row, byteSize: asCount(row.byteSize) }));
}

async function explain(connection, sql, values) {
  const prefix = connection.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
  if (connection.kind === "postgresql") {
    await connection.query("ANALYZE stored_object");
    await connection.query("ANALYZE brand_storage_limit");
    return connection.transaction(async (tx) => {
      await tx.query("SET LOCAL enable_seqscan = off");
      return queryWithParameters(tx, prefix + sql, values);
    });
  }
  return queryWithParameters(connection, prefix + sql, values);
}

async function upload(db, owner, brandId, files, storage) {
  return importSourceOriginals(db, owner, { brandId, files }, { env: storageEnv, storage, now });
}

test("messages: capacity copy exists in zh-CN and en", () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  assert.match(zhCN.sources.reasonCapacity, /容量/);
  assert.match(en.sources.reasonCapacity, /capacity|room/i);
  for (const text of [zhCN.sources.reasonCapacity, en.sources.reasonCapacity]) {
    assert.equal(text.includes("v1/"), false);
    assert.equal(text.includes("127.0.0.1"), false);
    assert.equal(text.includes("object_key"), false);
  }
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: capacity migration keeps an existing source original`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const previous = kind === "sqlite" ? "0070_polite_moonstone" : "0071_cynical_quasimodo";
    await migrateThrough(fixture.connection, previous);
    const db = fixture.connection;
    const owner = randomUUID();
    const brandId = randomUUID();
    const originalId = randomUUID();
    const verified = kind === "sqlite" ? 1 : true;
    await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
      owner, "Capacity owner", `${owner}@example.invalid`, verified,
    ]);
    await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
      VALUES (?, ?, 'active', 1, 1, ?)`, [brandId, owner, time]);
    await queryWithParameters(db, `INSERT INTO source_original (
      id, brand_id, owner_id, batch_id, file_name, byte_size, stored_object_id, status, reason, rights_status, created_at
    ) VALUES (?, ?, ?, ?, 'old.txt', 0, NULL, 'failed', 'unavailable', 'active', ?)`, [
      originalId, brandId, owner, randomUUID(), time,
    ]);
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [row] = await queryWithParameters(
      db,
      `SELECT reason, status, stored_object_id AS "storedObjectId" FROM source_original WHERE id = ?`,
      [originalId],
    );
    assert.equal(row.reason, "unavailable");
    assert.equal(row.status, "failed");
    assert.equal(row.storedObjectId, null);
    const [limit] = await queryWithParameters(db, "SELECT brand_id FROM brand_storage_limit WHERE brand_id = ?", [brandId]);
    assert.equal(limit, undefined);
  });

  test(`${kind}: source originals stop at the brand byte ceiling and leave older objects unchanged`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const owner = randomUUID();
    const outsider = randomUUID();
    const verified = kind === "sqlite" ? 1 : true;
    await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
      owner, "Capacity owner", `${owner}@example.invalid`, verified,
    ]);
    await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
      outsider, "Outsider", `${outsider}@example.invalid`, verified,
    ]);
    const brands = new BrandDao(db);
    const brandId = randomUUID();
    await brands.insertBrand(owner, brandId, time);
    await brands.insertVersion(brandId, 1, brandFields, time);
    assert.equal(await setBrandStorageLimit(db, brandId, 0), false);
    assert.equal((await queryWithParameters(db, "SELECT brand_id FROM brand_storage_limit WHERE brand_id = ?", [brandId])).length, 0);

    const storage = memoryStorage();
    const open = await upload(db, owner, brandId, [textFile("open.txt", "ok")], storage);
    assert.equal(open.error, undefined);
    assert.equal(open.files[0].status, "ready");
    assert.equal(open.files[0].storedObjectId === null, false);
    assert.equal(await liveBytes(db, brandId), 2);
    assert.equal(await setBrandStorageLimit(db, brandId, 4), true);

    const filled = await upload(db, owner, brandId, [textFile("fill.txt", "ok")], storage);
    assert.equal(filled.files[0].status, "ready");
    assert.equal(await liveBytes(db, brandId), 4);
    const before = await objectRows(db, brandId);
    assert.equal(before.length, 2);
    assert.equal(before.every((row) => row.status === "ready" && row.deletedAt === null), true);
    const puts = storage.calls.put;

    const blocked = await upload(db, owner, brandId, [textFile("over.txt", "x")], storage);
    assert.equal(blocked.error, undefined);
    assert.equal(blocked.files[0].status, "failed");
    assert.equal(blocked.files[0].reason, "capacity");
    assert.equal(blocked.files[0].storedObjectId, null);
    assert.equal(JSON.stringify(blocked).includes("v1/"), false);
    assert.equal(JSON.stringify(blocked).includes(storageEnv.S3_SECRET_ACCESS_KEY), false);
    assert.equal(storage.calls.put, puts);
    assert.deepEqual(await objectRows(db, brandId), before);
    assert.equal(await liveBytes(db, brandId), 4);
    const again = await upload(db, owner, brandId, [textFile("over-again.txt", "x")], storage);
    assert.equal(again.files[0].reason, "capacity");
    assert.deepEqual(await objectRows(db, brandId), before);

    const hidden = await upload(db, outsider, brandId, [textFile("foreign.txt", "x")], storage);
    assert.deepEqual(hidden, { error: "NOT_FOUND" });
    assert.equal(JSON.stringify(hidden).includes("v1/"), false);
    assert.equal(storage.calls.put, puts);
    assert.deepEqual(await objectRows(db, brandId), before);
    await queryWithParameters(db, "UPDATE brand SET status = 'archived' WHERE id = ?", [brandId]);

    const batchBrand = randomUUID();
    await brands.insertBrand(owner, batchBrand, time);
    await brands.insertVersion(batchBrand, 1, brandFields, time);
    assert.equal(await setBrandStorageLimit(db, batchBrand, 4), true);
    const batch = await upload(db, owner, batchBrand, [textFile("one.txt", "yes"), textFile("two.txt", "yes")], storage);
    assert.equal(JSON.stringify(batch).includes("v1/"), false);
    const byName = new Map(batch.files.map((file) => [file.fileName, file]));
    assert.equal(byName.get("one.txt").status, "ready");
    assert.equal(byName.get("two.txt").reason, "capacity");
    assert.equal(byName.get("two.txt").storedObjectId, null);
    assert.equal((await objectRows(db, batchBrand)).length, 1);
    assert.equal(await liveBytes(db, batchBrand), 3);
    await queryWithParameters(db, "UPDATE brand SET status = 'archived' WHERE id = ?", [batchBrand]);

    const otherBrand = randomUUID();
    await brands.insertBrand(owner, otherBrand, time);
    await brands.insertVersion(otherBrand, 1, brandFields, time);
    assert.equal(await setBrandStorageLimit(db, otherBrand, 1), true);
    const first = await upload(db, owner, otherBrand, [textFile("src.txt", "x")], storage);
    assert.equal(first.files[0].status, "ready");
    const second = await upload(db, owner, otherBrand, [textFile("src-2.txt", "y")], storage);
    assert.equal(second.files[0].reason, "capacity");
    const material = await saveStoredObject(db, {
      actorId: owner,
      brandId: otherBrand,
      class: "internal-material",
      visibility: "internal",
      fileName: "note.txt",
      contentType: "text/plain",
      body: new TextEncoder().encode("z"),
    }, { env: storageEnv, storage, now });
    assert.equal(material.ok, true);
    assert.equal(material.class, "internal-material");
    const classes = (await queryWithParameters(
      db,
      `SELECT "class", status FROM stored_object WHERE brand_id = ?`,
      [otherBrand],
    )).map((row) => ({ class: row.class, status: row.status }));
    classes.sort((left, right) => left.class.localeCompare(right.class));
    assert.deepEqual(classes, [
      { class: "internal-material", status: "ready" },
      { class: "source-original", status: "ready" },
    ]);
    await queryWithParameters(db, "UPDATE brand SET status = 'archived' WHERE id = ?", [otherBrand]);

    const failedBrand = randomUUID();
    await brands.insertBrand(owner, failedBrand, time);
    await brands.insertVersion(failedBrand, 1, brandFields, time);
    assert.equal(await setBrandStorageLimit(db, failedBrand, 2), true);
    const kept = await upload(db, owner, failedBrand, [textFile("keep.txt", "ok")], storage);
    assert.equal(await markObjectFailed(db, kept.files[0].storedObjectId, owner, "ready"), true);
    const replaced = await upload(db, owner, failedBrand, [textFile("next.txt", "ok")], storage);
    assert.equal(replaced.files[0].status, "ready");
    assert.equal(await liveBytes(db, failedBrand), 2);
    const failedRows = await objectRows(db, failedBrand);
    assert.equal(failedRows.length, 2);
    assert.equal(failedRows.filter((row) => row.status === "failed" && row.deletedAt === null).length, 1);
    assert.equal(failedRows.filter((row) => row.status === "ready" && row.deletedAt === null).length, 1);

    const sumPlan = JSON.stringify(await explain(db, liveBytesSql, [brandId]));
    const limitPlan = JSON.stringify(await explain(
      db,
      `SELECT byte_limit AS "byteLimit" FROM brand_storage_limit WHERE brand_id = ?`,
      [brandId],
    ));
    assert.match(sumPlan, /stored_object_brand_live_idx/);
    assert.match(limitPlan, /brand_storage_limit_pkey|sqlite_autoindex_brand_storage_limit_1/);
    assert.equal(sumPlan.includes("Seq Scan"), false);
    assert.equal(limitPlan.includes("Seq Scan"), false);
  });
}
