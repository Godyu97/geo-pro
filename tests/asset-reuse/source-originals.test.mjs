import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifySourceImport } from "../../src/features/asset-reuse/classify.ts";
import {
  importSourceOriginals,
  listImportedOriginals,
  presignSourceOriginal,
  readSourceOriginal,
  setSourceOriginalRights,
} from "../../src/features/asset-reuse/commands.ts";
import { sourceImportLimits } from "../../src/features/asset-reuse/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-21T08:00:00.000Z";
const now = new Date(time);
const body = Uint8Array.from([0x6f, 0x6b]);
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
  name: "己品牌",
  description: "Synthetic brand for source originals",
  website: "https://ji.example.com",
  aliases: ["己"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

function file(name, extra = {}) {
  return {
    name,
    contentType: "text/plain",
    chars: 2,
    encrypted: false,
    pages: [{ page: 1, text: "ok" }],
    body,
    ...extra,
  };
}

function memoryStorage() {
  const objects = new Map();
  const calls = { put: 0, get: 0, presign: 0 };
  return {
    calls,
    async putAndReadBack({ key, body: bytes, contentType }) {
      calls.put += 1;
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      objects.set(key, bytes);
      return { ok: true, status: "ready", bucket: "app-files", key, byteSize: bytes.byteLength, sha256, contentType };
    },
    async getObject({ key }) {
      calls.get += 1;
      const stored = objects.get(key);
      if (!stored) return { ok: false, status: "failed", code: "unavailable" };
      return { ok: true, body: stored, byteSize: stored.byteLength, sha256: createHash("sha256").update(stored).digest("hex") };
    },
    async deleteObject() {
      return { ok: true };
    },
    async presignGet({ key }) {
      calls.presign += 1;
      return { ok: true, url: `http://192.0.2.10:8333/app-files/${key}?X-Amz-Expires=900`, expiresInSeconds: 900 };
    },
  };
}

function trace(connection) {
  const queries = [];
  const wrap = (current) => ({
    kind: current.kind,
    query(sql, values) {
      queries.push(sql);
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

async function explain(connection, sql, values) {
  const prefix = connection.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
  if (connection.kind === "postgresql") {
    await connection.query("ANALYZE source_original");
    return connection.transaction(async (tx) => {
      await tx.query("SET LOCAL enable_seqscan = off");
      return queryWithParameters(tx, prefix + sql, values);
    });
  }
  return queryWithParameters(connection, prefix + sql, values);
}

test("messages: source import results exist in zh-CN and en", () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  for (const key of ["reasonEncrypted", "reasonOversized", "reasonUnrecognized", "reasonBatchLimit", "rightsRevoked", "rightsExpired", "statusPartial", "notApproved"]) {
    assert.match(zhCN.sources[key], /加密|10 MB|识别|10 个|撤销|到期|页码|批准/);
    assert.match(en.sources[key], /encrypted|10 MB|recognized|10 files|revoked|expired|page number|approved/);
    assert.equal(zhCN.sources[key].includes("127.0.0.1"), false);
    assert.equal(en.sources[key].includes("v1/"), false);
  }
});

test("pure: retained files stay unapproved and rejected files are not writable", () => {
  const classified = classifySourceImport([
    file("kept.txt"),
    file("huge.txt", { chars: sourceImportLimits.maxChars + 1 }),
    file("locked.pdf", { contentType: "application/pdf", encrypted: true, pages: [] }),
    file("run.bin", { contentType: "application/octet-stream" }),
    file("scan.md", { contentType: "text/markdown", pages: [{ page: 1, text: "ok" }, { page: null, text: null }] }),
  ]);
  assert.equal(classified.factsApproved, false);
  assert.deepEqual(classified.files.map((item) => [item.fileName, item.status, item.reason, item.write]), [
    ["kept.txt", "ready", null, true],
    ["huge.txt", "failed", "oversized", false],
    ["locked.pdf", "failed", "encrypted", false],
    ["run.bin", "failed", "unrecognized", false],
    ["scan.md", "partial", null, true],
  ]);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: source originals keep ready objects, stop downloads after rights change, and hide bytes`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const baseline = kind === "sqlite" ? "0027_real_fallen_one" : "0028_new_patch";
    await migrateThrough(fixture.connection, baseline);
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const db = fixture.connection;
    const owner = randomUUID();
    const outsider = randomUUID();
    await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
      owner, "Source owner", `${owner}@example.invalid`, kind === "sqlite" ? 1 : true,
    ]);
    await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
      outsider, "Outsider", `${outsider}@example.invalid`, kind === "sqlite" ? 1 : true,
    ]);
    const brandId = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brandId, time);
    await brands.insertVersion(brandId, 1, brandFields, time);

    const fillers = Array.from({ length: 5 }, (_, index) => file(`pad-${index}.txt`));
    const importedFiles = [
      file("kept.txt"),
      file("scan.md", { contentType: "text/markdown", pages: [{ page: 1, text: "ok" }, { page: null, text: null }] }),
      file("huge.txt", { chars: sourceImportLimits.maxChars + 1 }),
      file("locked.pdf", { contentType: "application/pdf", encrypted: true, pages: [] }),
      file("run.bin", { contentType: "application/octet-stream" }),
      ...fillers,
      file("eleventh.txt"),
    ];
    const storage = memoryStorage();
    const traced = trace(db);
    const imported = await importSourceOriginals(traced.connection, owner, { brandId, files: importedFiles }, {
      env: storageEnv,
      storage,
      now,
    });
    assert.equal(imported.error, undefined);
    assert.equal(imported.factsApproved, false);
    assert.equal(JSON.stringify(imported).includes("v1/"), false);
    assert.equal(JSON.stringify(imported).includes(storageEnv.S3_SECRET_ACCESS_KEY), false);
    const byName = new Map(imported.files.map((item) => [item.fileName, item]));
    assert.equal(byName.get("kept.txt").status, "ready");
    assert.equal(byName.get("kept.txt").storedObjectId === null, false);
    assert.equal(byName.get("scan.md").status, "partial");
    assert.equal(byName.get("scan.md").storedObjectId === null, false);
    for (const name of ["huge.txt", "locked.pdf", "run.bin", "eleventh.txt"]) {
      assert.equal(byName.get(name).storedObjectId, null);
      assert.equal(byName.get(name).status, "failed");
    }
    assert.equal(byName.get("huge.txt").reason, "oversized");
    assert.equal(byName.get("locked.pdf").reason, "encrypted");
    assert.equal(byName.get("run.bin").reason, "unrecognized");
    assert.equal(byName.get("eleventh.txt").reason, "batch_limit");
    assert.equal(storage.calls.put, 7);
    assert.equal(traced.queries.filter((sql) => sql.includes("INSERT INTO source_original")).length, 1);

    const objects = await queryWithParameters(
      db,
      `SELECT file_name AS "fileName", status, visibility, "class" FROM stored_object WHERE brand_id = ? AND "class" = 'source-original'`,
      [brandId],
    );
    assert.equal(objects.length, 7);
    assert.equal(objects.every((row) => row.status === "ready" && row.visibility === "internal" && row.class === "source-original"), true);
    assert.equal(objects.some((row) => row.fileName === "huge.txt" || row.fileName === "locked.pdf" || row.fileName === "run.bin"), false);

    const read = await readSourceOriginal(db, owner, { brandId, id: byName.get("kept.txt").id }, { env: storageEnv, storage, now });
    assert.equal(read.error, undefined);
    assert.deepEqual(read.body, body);
    const getsAfterOwner = storage.calls.get;
    const hidden = await readSourceOriginal(db, outsider, { brandId, id: byName.get("kept.txt").id }, { env: storageEnv, storage, now });
    assert.equal(hidden.error, "NOT_FOUND");
    assert.equal(hidden.body, undefined);
    assert.equal(storage.calls.get, getsAfterOwner);

    const signed = await presignSourceOriginal(db, owner, { brandId, id: byName.get("kept.txt").id }, { env: storageEnv, storage, now });
    assert.equal(signed.error, undefined);
    assert.match(signed.url, /^http:\/\/192\.0\.2\.10:8333\//);
    const revoked = await setSourceOriginalRights(db, owner, { brandId, id: byName.get("kept.txt").id, rights: "revoked" });
    assert.equal(revoked.file.rightsStatus, "revoked");
    assert.equal(revoked.file.fileName, "kept.txt");
    const presigns = storage.calls.presign;
    const blocked = await presignSourceOriginal(db, owner, { brandId, id: byName.get("kept.txt").id }, { env: storageEnv, storage, now });
    assert.equal(blocked.error, "NOT_FOUND");
    assert.equal(blocked.url, undefined);
    assert.equal(storage.calls.presign, presigns);
    const expired = await setSourceOriginalRights(db, owner, { brandId, id: byName.get("scan.md").id, rights: "expired" });
    assert.equal(expired.file.rightsStatus, "expired");
    const expiredSign = await presignSourceOriginal(db, owner, { brandId, id: byName.get("scan.md").id }, { env: storageEnv, storage, now });
    assert.equal(expiredSign.error, "NOT_FOUND");

    await queryWithParameters(db, "UPDATE brand SET frozen_at = ? WHERE id = ?", [time, brandId]);
    const frozenSign = await presignSourceOriginal(db, owner, { brandId, id: byName.get("pad-0.txt").id }, { env: storageEnv, storage, now });
    assert.equal(frozenSign.error, "NOT_FOUND");
    const history = await listImportedOriginals(db, owner, brandId);
    assert.equal(history.error, undefined);
    const names = history.files.map((item) => item.fileName);
    assert.equal(names.includes("kept.txt") && names.includes("huge.txt") && names.includes("scan.md"), true);
    assert.equal(history.files.find((item) => item.fileName === "kept.txt").rightsStatus, "revoked");
    const outsiderList = await listImportedOriginals(db, outsider, brandId);
    assert.equal(outsiderList.error, "NOT_FOUND");

    const plan = await explain(
      db,
      `SELECT id FROM source_original WHERE owner_id = ? AND brand_id = ? ORDER BY created_at DESC, batch_id DESC, id DESC LIMIT ?`,
      [owner, brandId, 50],
    );
    const planText = JSON.stringify(plan);
    assert.match(planText, /source_original_(owner_idx|brand_idx)/);
    assert.equal(planText.includes("Seq Scan"), false);
  });
}
