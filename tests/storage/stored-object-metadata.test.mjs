import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  buildObjectKey,
  MAX_OWNED_EXPORT_BYTES,
  MAX_STORED_OBJECT_BYTES,
  objectByteLimit,
  sanitizeObjectFileName,
} from "../../src/features/stored-objects/contracts.ts";
import {
  listStoredObjects,
  presignStoredObject,
  readStoredObject,
  saveStoredObject,
} from "../../src/features/stored-objects/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { MAX_OBJECT_BYTES } from "../../src/lib/storage/index.ts";
import { createObjectStorage } from "../../src/lib/storage/index.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const secret = "s3-secret-not-for-logs";
const browserEndpoint = "http://192.0.2.10:8333";
const payloadText = "OWNER-BYTES-SECRET";
const now = new Date("2026-11-21T03:04:05.000Z");
const fields = {
  name: "合成品牌",
  description: "Synthetic stored object fixture",
  website: "",
  aliases: [],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

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
    if (behavior.deny) {
      res.writeHead(403, { "content-type": "application/xml" });
      res.end("<?xml version=\"1.0\"?><Error><Code>AccessDenied</Code><Message>denied</Message></Error>");
      return;
    }
    if (req.method === "PUT") {
      objects.set(url.pathname, body);
      res.writeHead(200, { etag: '"stored"' });
      res.end();
      return;
    }
    if (req.method === "DELETE") {
      if (behavior.deleteStatus) {
        res.writeHead(behavior.deleteStatus);
        res.end();
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
    const payload = behavior.corruptGet ? Buffer.from("different-bytes") : stored;
    res.writeHead(200, { "content-type": "text/plain", "content-length": String(payload.length) });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(payload);
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

async function explain(connection, sql, values) {
  const prefix = connection.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
  const statement = prefix + bind(connection.kind, sql);
  if (connection.kind === "postgresql") {
    await connection.query("ANALYZE stored_object");
    return connection.transaction(async (tx) => {
      await tx.query("SET LOCAL enable_seqscan = off");
      return tx.query(statement, values);
    });
  }
  return connection.query(statement, values);
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Object owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function brandFor(db, ownerId) {
  const brandId = randomUUID();
  const brands = new BrandDao(db);
  const createdAt = now.toISOString();
  await brands.insertBrand(ownerId, brandId, createdAt);
  await brands.insertVersion(brandId, 1, fields, createdAt);
  return brandId;
}

async function objectRow(db, id) {
  const [row] = await queryWithParameters(
    db,
    `SELECT status, sha256, byte_size AS "byteSize", object_key AS "objectKey", immutable
     FROM stored_object WHERE id = ?`,
    [id],
  );
  return row;
}

async function objectCount(db) {
  const [row] = await queryWithParameters(db, 'SELECT COUNT(*) AS "count" FROM stored_object', []);
  return Number(row.count);
}

test("object key parts and size limits stay on the server", () => {
  assert.equal(MAX_STORED_OBJECT_BYTES, MAX_OBJECT_BYTES);
  assert.equal(objectByteLimit("owned-export"), MAX_OWNED_EXPORT_BYTES);
  assert.equal(objectByteLimit("internal-material"), MAX_STORED_OBJECT_BYTES);
  assert.equal(sanitizeObjectFileName("../../notes.txt"), "notes.txt");
  assert.equal(sanitizeObjectFileName(".."), undefined);
  const ownerId = randomUUID();
  const brandId = randomUUID();
  const objectId = randomUUID();
  const key = buildObjectKey({
    ownerId,
    brandId,
    class: "internal-material",
    objectId,
    fileName: "notes.txt",
  });
  assert.equal(key, `v1/${ownerId}/${brandId}/internal-material/${objectId}/notes.txt`);
  assert.equal(buildObjectKey({
    ownerId: "../owner",
    brandId,
    class: "internal-material",
    objectId,
    fileName: "notes.txt",
  }), undefined);
  assert.equal(buildObjectKey({
    ownerId,
    brandId: null,
    class: "owned-export",
    objectId,
    fileName: "export.json",
  }), `v1/${ownerId}/account/owned-export/${objectId}/export.json`);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: stored object metadata authorizes writes and reads`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const imported = await testDatabase(kind, { ddl: true });
    t.after(() => imported.cleanup());
    assert.deepEqual(await structure(fixture.connection), await structure(imported.connection));

    const db = fixture.connection;
    const ownerId = await account(db);
    const brandId = await brandFor(db, ownerId);
    const otherId = await account(db);
    await brandFor(db, otherId);
    const behavior = { deny: false, corruptGet: false, deleteStatus: undefined };
    const mock = await startMock(t, behavior);
    const env = baseEnv(mock.port);
    const storage = createObjectStorage({ env });
    const options = { env, storage, now };

    const before = await objectCount(db);
    const rejected = await saveStoredObject(db, {
      actorId: ownerId,
      brandId,
      class: "internal-material",
      visibility: "public",
      fileName: "notes.txt",
      contentType: "text/plain",
      body: Buffer.from("nope"),
    }, options);
    assert.deepEqual(rejected, { ok: false, code: "rejected" });
    assert.equal(await objectCount(db), before);

    const traced = trace(db);
    const saved = await saveStoredObject(traced.connection, {
      actorId: ownerId,
      brandId,
      class: "internal-material",
      visibility: "internal",
      fileName: "nested/../../notes.txt",
      contentType: "text/plain",
      body: Buffer.from(payloadText),
    }, options);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.status, "ready");
    assert.equal(saved.byteSize, Buffer.byteLength(payloadText));
    assert.equal(saved.sha256, sha256(Buffer.from(payloadText)));
    assert.equal(saved.fileName, "notes.txt");
    assert.equal("bucket" in saved, false);
    assert.equal(JSON.stringify(saved).includes(secret), false);
    assert.equal(JSON.stringify(saved).includes("app-files"), false);
    const row = await objectRow(db, saved.id);
    assert.equal(row.status, "ready");
    assert.equal(row.sha256, saved.sha256);
    assert.equal(Number(row.byteSize), saved.byteSize);
    assert.equal(row.objectKey, `v1/${ownerId}/${brandId}/internal-material/${saved.id}/notes.txt`);
    assert.equal(String(row.objectKey).includes(".."), false);
    assert.ok(traced.queries.length <= 6, `save used ${traced.queries.length} SQL statements`);
    console.log(JSON.stringify({
      event: "stored-object-save",
      kind,
      statements: traced.queries.length,
    }));

    const getsBefore = mock.requests.filter((request) => request.method === "GET").length;
    const read = await readStoredObject(db, { actorId: ownerId, objectId: saved.id }, options);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(Buffer.from(read.body).equals(Buffer.from(payloadText)), true);
    const signed = await presignStoredObject(db, { actorId: ownerId, objectId: saved.id }, options);
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    const url = new URL(signed.url);
    const browser = new URL(browserEndpoint);
    assert.equal(url.protocol, browser.protocol);
    assert.equal(url.hostname, browser.hostname);
    assert.equal(url.port, browser.port);
    assert.equal(signed.expiresInSeconds, 300);
    assert.ok(signed.expiresInSeconds <= 900);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
    assert.equal("bucket" in signed, false);
    assert.equal(JSON.stringify(signed).includes(secret), false);

    const deniedRead = await readStoredObject(db, { actorId: otherId, objectId: saved.id }, options);
    const deniedSign = await presignStoredObject(db, { actorId: otherId, objectId: saved.id }, options);
    assert.deepEqual(deniedRead, { ok: false, code: "not-found" });
    assert.deepEqual(deniedSign, { ok: false, code: "not-found" });
    assert.equal(JSON.stringify(deniedRead).includes(payloadText), false);
    assert.equal(JSON.stringify(deniedSign).includes(secret), false);
    assert.equal(deniedRead.body, undefined);
    assert.equal(deniedSign.url, undefined);
    const unknown = await readStoredObject(db, { actorId: ownerId, objectId: randomUUID() }, options);
    assert.deepEqual(unknown, { ok: false, code: "not-found" });
    assert.equal(mock.requests.filter((request) => request.method === "GET").length, getsBefore + 1);

    await queryWithParameters(
      db,
      "UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ?",
      [now.toISOString(), now.toISOString(), brandId],
    );
    const getsFrozen = mock.requests.filter((request) => request.method === "GET").length;
    const frozen = await readStoredObject(db, { actorId: ownerId, objectId: saved.id }, options);
    assert.deepEqual(frozen, { ok: false, code: "not-found" });
    assert.equal(JSON.stringify(frozen).includes(payloadText), false);
    assert.equal(mock.requests.filter((request) => request.method === "GET").length, getsFrozen);
    await queryWithParameters(db, "UPDATE brand SET frozen_at = NULL, restore_until = NULL WHERE id = ?", [brandId]);

    const packageBody = Buffer.from("# package\n");
    const firstPackage = await saveStoredObject(db, {
      actorId: ownerId,
      brandId,
      class: "delivery-package",
      visibility: "internal",
      fileName: "content.md",
      contentType: "text/markdown",
      body: packageBody,
    }, options);
    assert.equal(firstPackage.ok, true);
    if (!firstPackage.ok) return;
    const putsBeforeReplace = mock.requests.filter((request) => request.method === "PUT").length;
    const replaced = await saveStoredObject(db, {
      actorId: ownerId,
      brandId,
      class: "delivery-package",
      visibility: "internal",
      fileName: "content.md",
      contentType: "text/markdown",
      body: Buffer.from("# changed\n"),
      objectId: firstPackage.id,
    }, options);
    assert.deepEqual(replaced, { ok: false, code: "immutable" });
    assert.equal(mock.requests.filter((request) => request.method === "PUT").length, putsBeforeReplace);
    const unchanged = await objectRow(db, firstPackage.id);
    assert.equal(unchanged.status, "ready");
    assert.equal(unchanged.sha256, sha256(packageBody));
    const secondPackage = await saveStoredObject(db, {
      actorId: ownerId,
      brandId,
      class: "delivery-package",
      visibility: "internal",
      fileName: "content.md",
      contentType: "text/markdown",
      body: Buffer.from("# next\n"),
    }, options);
    assert.equal(secondPackage.ok, true);
    if (!secondPackage.ok) return;
    assert.notEqual(secondPackage.id, firstPackage.id);
    const secondRow = await objectRow(db, secondPackage.id);
    assert.notEqual(secondRow.objectKey, unchanged.objectKey);
    assert.equal((await objectRow(db, firstPackage.id)).sha256, sha256(packageBody));

    behavior.corruptGet = true;
    const mismatched = await saveStoredObject(db, {
      actorId: ownerId,
      brandId,
      class: "internal-material",
      visibility: "internal",
      fileName: "broken.txt",
      contentType: "text/plain",
      body: Buffer.from("checksum"),
    }, options);
    assert.deepEqual(mismatched, { ok: false, code: "failed" });
    assert.equal(JSON.stringify(mismatched).includes(secret), false);
    const failedRows = await queryWithParameters(
      db,
      `SELECT id, status FROM stored_object WHERE file_name = 'broken.txt'`,
      [],
    );
    assert.equal(failedRows.length, 1);
    assert.equal(failedRows[0].status, "failed");
    assert.equal([...mock.objects.keys()].some((key) => key.endsWith("/broken.txt")), false);
    behavior.corruptGet = false;

    behavior.deny = true;
    behavior.deleteStatus = 500;
    const deniedSave = await saveStoredObject(db, {
      actorId: ownerId,
      brandId,
      class: "internal-material",
      visibility: "internal",
      fileName: "denied.txt",
      contentType: "text/plain",
      body: Buffer.from("BODY-SHOULD-NOT-BE-LOGGED"),
    }, options);
    assert.deepEqual(deniedSave, { ok: false, code: "failed" });
    assert.equal(JSON.stringify(deniedSave).includes(secret), false);
    assert.equal(JSON.stringify(deniedSave).includes("BODY-SHOULD-NOT-BE-LOGGED"), false);
    const deniedRow = await queryWithParameters(
      db,
      `SELECT status FROM stored_object WHERE file_name = 'denied.txt'`,
      [],
    );
    assert.equal(deniedRow[0].status, "failed");
    behavior.deny = false;
    behavior.deleteStatus = undefined;
    const deletesBefore = mock.requests.filter((request) => request.method === "DELETE").length;
    const retried = await saveStoredObject(db, {
      actorId: ownerId,
      brandId,
      class: "authorized-media",
      visibility: "public",
      fileName: "cover.png",
      contentType: "image/png",
      body: Buffer.from("png-bytes"),
    }, options);
    assert.equal(retried.ok, true);
    assert.ok(mock.requests.filter((request) => request.method === "DELETE").length > deletesBefore);
    assert.equal((await queryWithParameters(
      db,
      `SELECT status FROM stored_object WHERE file_name = 'denied.txt'`,
      [],
    ))[0].status, "failed");

    const exported = await saveStoredObject(db, {
      actorId: ownerId,
      brandId: null,
      class: "owned-export",
      visibility: "internal",
      fileName: "export.json",
      contentType: "application/json",
      body: Buffer.from("{\"sections\":[]}"),
    }, options);
    assert.equal(exported.ok, true);
    if (!exported.ok) return;
    const otherExport = await readStoredObject(db, { actorId: otherId, objectId: exported.id }, options);
    assert.deepEqual(otherExport, { ok: false, code: "not-found" });
    assert.equal(JSON.stringify(otherExport).includes("sections"), false);
    const ownExport = await readStoredObject(db, { actorId: ownerId, objectId: exported.id }, options);
    assert.equal(ownExport.ok, true);

    const digest = "ab".repeat(32);
    const stamp = now.toISOString();
    for (const id of [randomUUID(), randomUUID()]) {
      await queryWithParameters(
        db,
        `INSERT INTO stored_object (
          id, owner_id, brand_id, "class", visibility, status, bucket, object_key, content_type,
          byte_size, sha256, file_name, immutable, created_at, ready_at, deleted_at
        ) VALUES (?, ?, ?, 'internal-material', 'internal', 'tombstoned', 'app-files', NULL, 'text/plain',
          4, ?, NULL, 0, ?, NULL, ?)`,
        [id, ownerId, brandId, digest, stamp, stamp],
      );
    }
    await assert.rejects(() => queryWithParameters(
      db,
      `INSERT INTO stored_object (
        id, owner_id, brand_id, "class", visibility, status, bucket, object_key, content_type,
        byte_size, sha256, file_name, immutable, created_at, ready_at, deleted_at
      ) VALUES (?, ?, ?, 'internal-material', 'public', 'ready', 'app-files', ?, 'text/plain',
        4, ?, 'bad.txt', 0, ?, ?, NULL)`,
      [randomUUID(), ownerId, brandId, `v1/${ownerId}/${brandId}/internal-material/${randomUUID()}/bad.txt`, digest, stamp, stamp],
    ));

    const planOwner = ownerId;
    const planBrand = brandId;
    const planRows = Array.from({ length: 40 }, (_, index) => {
      const id = randomUUID();
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      return [
        id, planOwner, planBrand, `v1/${planOwner}/${planBrand}/source-original/${id}/note.txt`, createdAt,
      ];
    });
    for (const [id, planOwnerId, planBrandId, objectKey, createdAt] of planRows) {
      await queryWithParameters(
        db,
        `INSERT INTO stored_object (
          id, owner_id, brand_id, "class", visibility, status, bucket, object_key, content_type,
          byte_size, sha256, file_name, immutable, created_at, ready_at, deleted_at
        ) VALUES (?, ?, ?, 'source-original', 'internal', 'ready', 'app-files', ?, 'text/plain',
          4, ?, 'note.txt', 0, ?, ?, NULL)`,
        [id, planOwnerId, planBrandId, objectKey, digest, createdAt, createdAt],
      );
    }
    const listedTrace = trace(db);
    const listed = await listStoredObjects(listedTrace.connection, {
      actorId: planOwner,
      brandId: planBrand,
      class: "source-original",
      limit: 100,
    });
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.objects.length, 40);
    assert.equal(listed.objects.some((item) => "bucket" in item || "objectKey" in item), false);
    assert.equal(listedTrace.queries.length, 2);
    const listQuery = listedTrace.queries.find((query) => query.sql.includes("FROM stored_object"));
    assert.ok(listQuery);
    const prefix = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
    const ownerPlanRows = db.kind === "postgresql"
      ? await db.transaction(async (tx) => {
        await tx.query("ANALYZE stored_object");
        await tx.query("SET LOCAL enable_seqscan = off");
        return tx.query(prefix + listQuery.sql, listQuery.values);
      })
      : await db.query(prefix + listQuery.sql, listQuery.values);
    const ownerPlan = JSON.stringify(ownerPlanRows);
    const brandPlan = JSON.stringify(await explain(
      db,
      "SELECT id FROM stored_object WHERE brand_id = ? ORDER BY created_at ASC, id ASC LIMIT ?",
      [planBrand, 100],
    ));
    assert.match(ownerPlan, /stored_object_owner_idx/);
    assert.match(brandPlan, /stored_object_brand_idx/);
    console.log(JSON.stringify({
      event: "stored-object-plan",
      kind,
      listStatements: listedTrace.queries.length,
      ownerIndex: ownerPlan.includes("stored_object_owner_idx"),
      brandIndex: brandPlan.includes("stored_object_brand_idx"),
    }));
  });
}
