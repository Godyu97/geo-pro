import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { inspectBrandPurge, retryBrandPurge } from "../../src/features/brands/purge.ts";
import { brandPurgeSteps } from "../../src/features/brands/purge-steps.ts";
import {
  presignStoredObject,
  readStoredObject,
  saveStoredObject,
} from "../../src/features/stored-objects/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { createObjectStorage } from "../../src/lib/storage/index.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const secret = "s3-secret-not-for-logs";
const browserEndpoint = "http://192.0.2.10:8333";
const readyBody = "OWNER-BYTES-SECRET";
const otherBody = "OTHER-BRAND-BYTES";
const failedBody = "FAILED-BODY-SECRET";
const pendingBody = "PENDING-BODY-SECRET";
const readyName = "secret-name.txt";
const otherName = "other-brand.txt";
const failedName = "failed-name.txt";
const pendingName = "pending-name.txt";
const createdAt = "2026-11-01T00:00:00.000Z";
const frozenAt = "2026-11-02T00:00:00.000Z";
const dueAt = "2026-12-02T00:00:00.000Z";
const clock = () => dueAt;
const fields = { ...initialBrandFields, name: "合成冻结品牌", description: "Synthetic object retention fixture" };

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function baseEnv(port) {
  return {
    S3_ENDPOINT: `http://127.0.0.1:${port}`,
    S3_ENDPOINT_BROWSER: browserEndpoint,
    S3_REGION: "us-east-1",
    S3_BUCKET: "app-files",
    S3_ACCESS_KEY_ID: "local-app",
    S3_SECRET_ACCESS_KEY: secret,
    S3_FORCE_PATH_STYLE: "true",
  };
}

function createS3Mock(behavior) {
  const requests = [];
  const objects = new Map();
  const handler = async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({ method: req.method, path: url.pathname, body });
    if (req.method === "PUT") {
      if (behavior.deny) {
        res.writeHead(403, { "content-type": "application/xml" });
        res.end("<?xml version=\"1.0\"?><Error><Code>AccessDenied</Code></Error>");
        return;
      }
      objects.set(url.pathname, body);
      res.writeHead(200, { etag: '"stored"' });
      res.end();
      return;
    }
    if (req.method === "DELETE") {
      if (behavior.deleteStatus) {
        res.writeHead(behavior.deleteStatus, { "content-type": "application/xml" });
        res.end("<?xml version=\"1.0\"?><Error><Code>InternalError</Code></Error>");
        return;
      }
      if (!objects.has(url.pathname)) {
        res.writeHead(404, { "content-type": "application/xml" });
        res.end("<?xml version=\"1.0\"?><Error><Code>NoSuchKey</Code></Error>");
        return;
      }
      objects.delete(url.pathname);
      res.writeHead(204);
      res.end();
      return;
    }
    const stored = objects.get(url.pathname);
    if (!stored) {
      res.writeHead(404, { "content-type": "application/xml" });
      res.end("<?xml version=\"1.0\"?><Error><Code>NoSuchKey</Code></Error>");
      return;
    }
    res.writeHead(200, { "content-type": "text/plain", "content-length": String(stored.length) });
    res.end(req.method === "HEAD" ? undefined : stored);
  };
  return { requests, objects, handler };
}

async function startMock(t, behavior) {
  const mock = createS3Mock(behavior);
  const server = createServer(mock.handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("S3 mock did not bind a TCP port.");
  return { ...mock, port: address.port };
}

function trace(connection) {
  const queries = [];
  const wrap = (current) => ({
    kind: current.kind,
    query(sql, values) {
      queries.push({ sql, values: values ?? [] });
      return current.query(sql, values);
    },
    transaction(work) {
      return current.transaction((tx) => work(wrap(tx)));
    },
    savepoint(work) {
      return current.savepoint((nested) => work(wrap(nested)));
    },
    close() {
      return current.close();
    },
  });
  return { connection: wrap(connection), queries };
}

function bind(kind, sql) {
  if (kind !== "postgresql") return sql;
  let parameter = 0;
  return sql.replaceAll("?", () => `$${++parameter}`);
}

function previousMigration(kind) {
  const source = kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json";
  const journal = JSON.parse(readFileSync(source, "utf8"));
  return journal.entries.at(-2).tag;
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "对象负责人", `${id}@example.invalid`]);
  return id;
}

async function brandFor(db, ownerId) {
  const brandId = randomUUID();
  const brands = new BrandDao(db);
  await brands.insertBrand(ownerId, brandId, createdAt);
  await brands.insertVersion(brandId, 1, fields, createdAt);
  return brandId;
}

async function objectRecord(db, id) {
  const [row] = await queryWithParameters(
    db,
    `SELECT id, "class", status, byte_size AS "byteSize", sha256, file_name AS "fileName",
       object_key AS "objectKey", created_at AS "createdAt", deleted_at AS "deletedAt"
     FROM stored_object WHERE id = ?`,
    [id],
  );
  return row;
}

function leaksCustomerText(value) {
  const encoded = JSON.stringify(value);
  return [readyBody, otherBody, failedBody, pendingBody, readyName, otherName, failedName, pendingName, secret, "X-Amz-"]
    .some((needle) => encoded.includes(needle));
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: completed purge receipts keep their finished step when object deletion is inserted`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousMigration(kind));
    const finished = randomUUID();
    const waiting = randomUUID();
    const ownerId = randomUUID();
    await queryWithParameters(
      db,
      `INSERT INTO brand_purge (brand_id, owner_id, frozen_at, started_at, step, issue, completed_at)
       VALUES (?, ?, ?, ?, 3, NULL, ?), (?, ?, ?, ?, 2, NULL, NULL)`,
      [finished, ownerId, frozenAt, frozenAt, dueAt, waiting, ownerId, frozenAt, frozenAt],
    );
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: "pipe" });
    const rows = await queryWithParameters(
      db,
      `SELECT brand_id AS "brandId", step, issue, completed_at AS "completedAt" FROM brand_purge ORDER BY step`,
      [],
    );
    assert.deepEqual(rows.map((row) => ({ ...row, step: Number(row.step) })), [
      { brandId: waiting, step: 2, issue: null, completedAt: null },
      { brandId: finished, step: brandPurgeSteps.length, issue: null, completedAt: dueAt },
    ]);
  });

  test(`${kind}: frozen brands refuse downloads and purge deletes only that brand's bytes`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const ownerId = await account(db);
    const brandId = await brandFor(db, ownerId);
    const behavior = { deny: false, deleteStatus: undefined };
    const mock = await startMock(t, behavior);
    const env = baseEnv(mock.port);
    const storage = createObjectStorage({ env });
    const options = { env, storage, now: new Date(createdAt) };
    const save = (target, fileName, body) => saveStoredObject(db, {
      actorId: ownerId,
      brandId: target,
      class: "internal-material",
      visibility: "internal",
      fileName,
      contentType: "text/plain",
      body: Buffer.from(body),
    }, options);

    const saved = await save(brandId, readyName, readyBody);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    await queryWithParameters(db, "UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ?", [frozenAt, dueAt, brandId]);
    const deletesAtFreeze = mock.requests.filter((request) => request.method === "DELETE").length;
    const putsAtFreeze = mock.requests.filter((request) => request.method === "PUT").length;
    const frozenSign = await presignStoredObject(db, { actorId: ownerId, objectId: saved.id }, options);
    const frozenRead = await readStoredObject(db, { actorId: ownerId, objectId: saved.id }, options);
    const frozenSave = await save(brandId, "another.txt", "should-not-upload");
    assert.deepEqual(frozenSign, { ok: false, code: "not-found" });
    assert.deepEqual(frozenRead, { ok: false, code: "not-found" });
    assert.deepEqual(frozenSave, { ok: false, code: "not-found" });
    assert.equal(frozenSign.url, undefined);
    assert.equal(frozenRead.body, undefined);
    assert.equal(leaksCustomerText(frozenSign), false);
    assert.equal(leaksCustomerText(frozenRead), false);
    assert.equal(mock.requests.filter((request) => request.method === "DELETE").length, deletesAtFreeze);
    assert.equal(mock.requests.filter((request) => request.method === "PUT").length, putsAtFreeze);
    const retained = await objectRecord(db, saved.id);
    assert.equal(retained.status, "ready");
    assert.equal(retained.fileName, readyName);
    assert.equal([...mock.objects.values()].some((body) => body.equals(Buffer.from(readyBody))), true);

    await queryWithParameters(db, "UPDATE brand SET frozen_at = NULL, restore_until = NULL WHERE id = ?", [brandId]);
    const restored = await readStoredObject(db, { actorId: ownerId, objectId: saved.id }, options);
    const restoredSign = await presignStoredObject(db, { actorId: ownerId, objectId: saved.id }, options);
    assert.equal(restored.ok, true);
    if (!restored.ok || !restoredSign.ok) return;
    assert.equal(Buffer.from(restored.body).equals(Buffer.from(readyBody)), true);
    assert.equal(restoredSign.expiresInSeconds <= 900, true);

    behavior.deny = true;
    const failed = await save(brandId, failedName, failedBody);
    assert.deepEqual(failed, { ok: false, code: "failed" });
    behavior.deny = false;
    const [failedRow] = await queryWithParameters(
      db,
      `SELECT id, object_key AS "objectKey" FROM stored_object WHERE brand_id = ? AND file_name = ?`,
      [brandId, failedName],
    );
    const pendingId = randomUUID();
    const pendingKey = `v1/${ownerId}/${brandId}/internal-material/${pendingId}/${pendingName}`;
    const pendingDigest = sha256(Buffer.from(pendingBody));
    await queryWithParameters(
      db,
      `INSERT INTO stored_object (
        id, owner_id, brand_id, "class", visibility, status, bucket, object_key, content_type,
        byte_size, sha256, file_name, immutable, created_at, ready_at, deleted_at
      ) VALUES (?, ?, ?, 'internal-material', 'internal', 'pending', 'app-files', ?, 'text/plain',
        ?, ?, ?, 0, ?, NULL, NULL)`,
      [pendingId, ownerId, brandId, pendingKey, Buffer.byteLength(pendingBody), pendingDigest, pendingName, createdAt],
    );
    mock.objects.set(`/app-files/${pendingKey}`, Buffer.from(pendingBody));
    await queryWithParameters(db, "UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ?", [frozenAt, dueAt, brandId]);
    const otherBrandId = await brandFor(db, ownerId);
    const other = await save(otherBrandId, otherName, otherBody);
    assert.equal(other.ok, true);
    if (!other.ok) return;

    const otherOwnerId = await account(db);
    const blockedBrandId = await brandFor(db, otherOwnerId);
    const blocked = await saveStoredObject(db, {
      actorId: otherOwnerId,
      brandId: blockedBrandId,
      class: "internal-material",
      visibility: "internal",
      fileName: "blocked.txt",
      contentType: "text/plain",
      body: Buffer.from("blocked-bytes"),
    }, options);
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;
    await queryWithParameters(
      db,
      "UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ?",
      [frozenAt, dueAt, blockedBrandId],
    );
    behavior.deleteStatus = 500;
    const blockedPurge = await retryBrandPurge(db, { ownerId: otherOwnerId, brandId: blockedBrandId }, clock, undefined, storage);
    assert.equal(blockedPurge.status, "incomplete");
    assert.equal(blockedPurge.receipt?.issue, "objects-failed");
    assert.deepEqual(blockedPurge.remaining, ["objects", "costs"]);
    const blockedRow = await objectRecord(db, blocked.id);
    assert.equal(blockedRow.status, "ready");
    assert.equal(blockedRow.fileName, "blocked.txt");
    assert.equal([...mock.objects.values()].some((body) => body.equals(Buffer.from("blocked-bytes"))), true);
    behavior.deleteStatus = undefined;
    const blockedRetry = await retryBrandPurge(db, { ownerId: otherOwnerId, brandId: blockedBrandId }, clock, undefined, storage);
    assert.equal(blockedRetry.status, "cleared");
    const blockedTombstone = await objectRecord(db, blocked.id);
    assert.equal(blockedTombstone.status, "tombstoned");
    assert.equal(blockedTombstone.fileName, null);
    assert.equal(blockedTombstone.objectKey, null);
    assert.equal([...mock.objects.values()].some((body) => body.equals(Buffer.from("blocked-bytes"))), false);

    const purgeSql = `SELECT id, object_key AS "objectKey" FROM stored_object
     WHERE owner_id = ? AND brand_id = ? AND status IN ('pending', 'ready', 'failed') AND object_key IS NOT NULL
     ORDER BY created_at ASC, id ASC`;
    const prefix = kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
    const planRows = kind === "postgresql"
      ? await db.transaction(async (tx) => {
        await tx.query("ANALYZE stored_object");
        await tx.query("SET LOCAL enable_seqscan = off");
        return tx.query(prefix + bind(kind, purgeSql), [ownerId, brandId]);
      })
      : await db.query(prefix + purgeSql, [ownerId, brandId]);
    const plan = JSON.stringify(planRows);
    assert.match(plan, /stored_object_(brand|owner)_idx/);
    console.log(JSON.stringify({
      event: "brand-object-purge-plan",
      kind,
      indexed: /stored_object_(brand|owner)_idx/.test(plan),
    }));

    const traced = trace(db);
    const purged = await retryBrandPurge(traced.connection, { ownerId, brandId }, clock, undefined, storage);
    assert.equal(purged.status, "cleared");
    assert.deepEqual(purged.remaining, []);
    const objectSql = traced.queries.filter((query) => query.sql.includes("stored_object"));
    assert.equal(objectSql.length, 2);
    assert.equal(objectSql.some((query) => query.sql.includes(readyName) || JSON.stringify(query.values).includes(readyBody)), false);

    for (const id of [saved.id, failedRow.id, pendingId]) {
      const row = await objectRecord(db, id);
      assert.equal(row.status, "tombstoned");
      assert.equal(row.fileName, null);
      assert.equal(row.objectKey, null);
      assert.equal(row.class, "internal-material");
      assert.equal(row.deletedAt, dueAt);
      assert.equal(leaksCustomerText(row), false);
    }
    const readyTombstone = await objectRecord(db, saved.id);
    assert.equal(readyTombstone.sha256, sha256(Buffer.from(readyBody)));
    assert.equal(Number(readyTombstone.byteSize), Buffer.byteLength(readyBody));
    assert.equal([...mock.objects.values()].some((body) => body.equals(Buffer.from(readyBody)) || body.equals(Buffer.from(pendingBody))), false);
    assert.equal(mock.requests.some((request) => request.method === "DELETE" && request.path.includes(other.id)), false);

    const otherRow = await objectRecord(db, other.id);
    assert.equal(otherRow.status, "ready");
    assert.equal(otherRow.fileName, otherName);
    const otherRead = await readStoredObject(db, { actorId: ownerId, objectId: other.id }, options);
    assert.equal(otherRead.ok, true);
    if (!otherRead.ok) return;
    assert.equal(Buffer.from(otherRead.body).equals(Buffer.from(otherBody)), true);

    const deletesAfter = mock.requests.filter((request) => request.method === "DELETE").length;
    const again = await retryBrandPurge(db, { ownerId, brandId }, clock, undefined, storage);
    assert.equal(again.status, "cleared");
    assert.equal(mock.requests.filter((request) => request.method === "DELETE").length, deletesAfter);

    const audit = await inspectBrandPurge(db, { ownerId, brandId });
    assert.equal(audit.objects.length, 3);
    assert.equal(audit.objects.every((row) => row.deletedAt === dueAt && !("fileName" in row) && !("objectKey" in row)), true);
    assert.equal(leaksCustomerText(audit), false);
    const denied = await presignStoredObject(db, { actorId: ownerId, objectId: saved.id }, options);
    assert.deepEqual(denied, { ok: false, code: "not-found" });
    assert.equal(leaksCustomerText(denied), false);
  });
}
