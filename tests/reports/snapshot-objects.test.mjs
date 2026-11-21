import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { reportSnapshotFileResponse } from "../../src/features/reports/download.ts";
import { generateReport, readSnapshot, requestRetest, reviseReport } from "../../src/features/reports/commands.ts";
import { saveStoredObject } from "../../src/features/stored-objects/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-21T09:00:00.000Z";
const clock = () => time;
const storageEnv = {
  S3_ENDPOINT: "http://127.0.0.1:9",
  S3_REGION: "us-east-1",
  S3_BUCKET: "app-files",
  S3_ACCESS_KEY_ID: "local-app",
  S3_SECRET_ACCESS_KEY: "s3-secret-not-for-logs",
  S3_FORCE_PATH_STYLE: "true",
};
const brandFields = {
  name: "己品牌",
  description: "Synthetic brand for report objects",
  website: "https://ji.example.com",
  aliases: ["己"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(
    kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json",
    "utf8",
  ));
  return journal.entries.at(-2).tag;
}

function memoryStorage() {
  const objects = new Map();
  const calls = { put: 0, get: 0 };
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
      throw new Error("historical or denied download must not touch the bucket");
    },
    async deleteObject() {
      return { ok: true };
    },
    async presignGet() {
      return { ok: false, status: "failed", code: "unavailable" };
    },
  };
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function snapshotBytes(storage) {
  return new Map([...storage.objects.entries()].map(([key, body]) => [key, Uint8Array.from(body)]));
}

function sample(overrides) {
  return {
    observationId: randomUUID(),
    queryId: "q1",
    queryVersion: "q1-v1",
    track: "model_api",
    channelVersion: "ch-v1",
    protocolVersion: "proto-v1",
    analysisRuleVersion: "analysis-v1",
    region: "CN",
    entityVersion: 1,
    judgable: true,
    numerator: 0,
    denominator: 1,
    ...overrides,
  };
}

function windows(beforeSamples, afterSamples) {
  return {
    before: { start: "2026-11-01T00:00:00.000Z", endExclusive: "2026-11-02T00:00:00.000Z", samples: beforeSamples },
    after: { start: "2026-11-10T00:00:00.000Z", endExclusive: "2026-11-11T00:00:00.000Z", samples: afterSamples },
  };
}

test("messages: report storage failure is bilingual and a denied download has no body", async () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  assert.match(zhCN.reports.SERVICE_UNAVAILABLE, /保存或读取/);
  assert.match(zhCN.reports.SERVICE_UNAVAILABLE, /重试/);
  assert.match(en.reports.SERVICE_UNAVAILABLE, /saved or read/i);
  assert.match(en.reports.SERVICE_UNAVAILABLE, /try again/i);
  assert.equal(zhCN.reports.SERVICE_UNAVAILABLE.includes("127.0.0.1"), false);
  assert.equal(en.reports.SERVICE_UNAVAILABLE.includes("report-snapshot"), false);
  const denied = reportSnapshotFileResponse(null, 404);
  assert.equal(denied.status, 404);
  assert.equal(await denied.text(), "");
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: report HTML and JSON are immutable objects; historical bytes stay inline`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const storage = memoryStorage();
    const options = { env: storageEnv, storage, now: new Date(time) };
    const account = async (name) => {
      const id = randomUUID();
      await queryWithParameters(
        db,
        'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
        [id, name, `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
      );
      return id;
    };
    const owner = await account("Report owner");
    const outsider = await account("Report outsider");
    const brandId = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brandId, time);
    await brands.insertVersion(brandId, 1, brandFields, time);
    const before = [1, 2, 3].map((index) => sample({
      queryId: `q${index}`,
      queryVersion: `q${index}-v1`,
      numerator: 0,
      sourceMissing: index === 1,
    }));
    const after = before.map((item) => sample({ ...item, observationId: randomUUID(), numerator: 1, sourceMissing: false }));
    const shared = windows(before, after);
    const retest = await requestRetest(db, owner, {
      action: "request-retest",
      brandId,
      operationId: randomUUID(),
      kind: "diagnostic",
      intent: "diagnostic",
      track: "model_api",
      timezone: "Asia/Shanghai",
      entityVersion: 1,
      before: shared.before,
      after: shared.after,
      locale: "zh-CN",
      metric: "recommendation_rate",
    }, clock);
    assert.equal(retest.error, undefined);
    const report = await generateReport(db, owner, {
      action: "generate-report",
      brandId,
      operationId: randomUUID(),
      retestId: retest.retest.id,
      before: shared.before,
      after: shared.after,
      locale: "zh-CN",
      metric: "recommendation_rate",
      brandName: "己品牌",
    }, clock, options);
    assert.equal(report.error, undefined);
    assert.equal(report.snapshot.sourceMissing, 1);
    assert.equal(report.snapshot.htmlBytes, "");
    assert.equal(report.snapshot.jsonBytes, "");
    assert.equal(report.snapshot.htmlBytes.includes("己品牌"), false);
    const [row] = await queryWithParameters(
      db,
      `SELECT html_object_id AS "htmlObjectId", json_object_id AS "jsonObjectId",
        html_sha256 AS "htmlSha256", json_sha256 AS "jsonSha256", html_bytes AS "htmlBytes", json_bytes AS "jsonBytes"
       FROM report_snapshot WHERE id = ?`,
      [report.snapshot.id],
    );
    assert.notEqual(row.htmlObjectId, row.jsonObjectId);
    const objects = await queryWithParameters(
      db,
      `SELECT id, "class" AS "class", visibility, immutable, status, content_type AS "contentType",
        file_name AS "fileName", sha256, object_key AS "objectKey"
       FROM stored_object WHERE id IN (?, ?)`,
      [row.htmlObjectId, row.jsonObjectId],
    );
    assert.equal(objects.length, 2);
    assert.ok(objects.every((object) => object.class === "report-snapshot" && object.visibility === "internal"
      && Number(object.immutable) === 1 && object.status === "ready"));
    assert.ok(objects.every((object) => String(object.objectKey).includes("/report-snapshot/")));
    assert.equal(objects.find((object) => object.id === row.htmlObjectId).fileName, "report.html");
    assert.equal(objects.find((object) => object.id === row.jsonObjectId).fileName, "report.json");
    const opened = await readSnapshot(db, owner, report.snapshot.id, options);
    assert.equal(opened.error, undefined);
    assert.equal(sha256Text(opened.html), row.htmlSha256);
    assert.equal(sha256Text(opened.json), row.jsonSha256);
    assert.equal(JSON.parse(opened.json).source_missing, true);
    assert.match(opened.json, /来源不可复核/);
    assert.equal(row.htmlBytes.includes(opened.html), false);
    assert.equal(row.jsonBytes.includes(opened.json), false);

    const putsAfterFirst = storage.calls.put;
    const htmlObject = objects.find((object) => object.id === row.htmlObjectId);
    const overwrite = await saveStoredObject(db, {
      actorId: owner,
      brandId,
      class: "report-snapshot",
      visibility: "internal",
      fileName: "report.html",
      contentType: "text/html",
      objectId: htmlObject.id,
      body: new TextEncoder().encode("<p>overwrite</p>"),
    }, options);
    assert.equal(overwrite.ok, false);
    assert.equal(overwrite.code, "immutable");
    assert.equal(storage.calls.put, putsAfterFirst);

    const firstBytes = snapshotBytes(storage);
    const revised = await reviseReport(db, owner, {
      action: "revise-report",
      brandId,
      operationId: randomUUID(),
      snapshotId: report.snapshot.id,
      before: shared.before,
      after: windows(before.map((item) => ({ ...item, sourceMissing: false })), after).after,
      locale: "zh-CN",
      metric: "recommendation_rate",
      brandName: "己品牌",
      note: "label correction",
    }, clock, options);
    assert.equal(revised.error, undefined);
    assert.notEqual(revised.snapshot.id, report.snapshot.id);
    assert.notEqual(revised.snapshot.htmlObjectId, row.htmlObjectId);
    assert.notEqual(revised.snapshot.jsonObjectId, row.jsonObjectId);
    for (const [key, body] of firstBytes) assert.deepEqual(storage.objects.get(key), body);
    const reread = await readSnapshot(db, owner, report.snapshot.id, options);
    assert.equal(reread.snapshot.sourceMissing, 1);
    assert.equal(reread.json, opened.json);
    assert.equal(reread.html, opened.html);
    assert.equal(JSON.parse(reread.json).source_missing, true);
    const next = await readSnapshot(db, owner, revised.snapshot.id, options);
    assert.notEqual(next.json, opened.json);
    assert.match(next.json, /label correction/);

    const getsBeforeDenial = storage.calls.get;
    const denied = await readSnapshot(db, outsider, report.snapshot.id, {
      env: storageEnv,
      storage: failingStorage(),
      now: new Date(time),
    });
    assert.equal(denied.error, "NOT_FOUND");
    assert.equal(denied.html, undefined);
    assert.equal(denied.json, undefined);
    assert.equal(storage.calls.get, getsBeforeDenial);
    const outsiderResponse = reportSnapshotFileResponse(null, 404);
    assert.equal(outsiderResponse.status, 404);
    assert.equal(await outsiderResponse.text(), "");
    assert.equal(outsiderResponse.headers.get("cache-control"), "private, no-store");

    await queryWithParameters(
      db,
      "UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ? AND owner_id = ?",
      [time, time, brandId, owner],
    );
    const frozenGets = storage.calls.get;
    const frozen = await readSnapshot(db, owner, report.snapshot.id, {
      env: storageEnv,
      storage: failingStorage(),
      now: new Date(time),
    });
    assert.equal(frozen.error, "NOT_FOUND");
    assert.equal(frozen.html, undefined);
    assert.equal(storage.calls.get, frozenGets);
    await queryWithParameters(
      db,
      "UPDATE brand SET frozen_at = NULL, restore_until = NULL WHERE id = ? AND owner_id = ?",
      [brandId, owner],
    );

    const historicalId = randomUUID();
    const historicalJson = JSON.stringify({ schema_version: "report-v3", source_missing: true, marker: "historical-inline" });
    const historicalHtml = "<p>Historical inline report</p>";
    await queryWithParameters(db, `INSERT INTO report_snapshot (
      id, brand_id, owner_id, retest_id, status, grade, intent, loop_completed, predecessor_id,
      entity_version, timezone, locale, source_missing, json_bytes, html_bytes, json_sha256, html_sha256,
      operation_id, created_at
    ) VALUES (?, ?, ?, ?, 'created', 'exploratory', 'diagnostic', 0, NULL, 1, 'Asia/Shanghai', 'zh-CN', 1, ?, ?, ?, ?, ?, ?)`, [
      historicalId, brandId, owner, retest.retest.id, historicalJson, historicalHtml,
      "a".repeat(64), "b".repeat(64), randomUUID(), time,
    ]);
    const historical = await readSnapshot(db, owner, historicalId, {
      env: storageEnv,
      storage: failingStorage(),
      now: new Date(time),
    });
    assert.equal(historical.error, undefined);
    assert.equal(historical.json, historicalJson);
    assert.equal(historical.html, historicalHtml);
    assert.equal(storage.calls.get, frozenGets);

    const beforeFailure = await queryWithParameters(
      db,
      "SELECT count(*) AS n FROM report_snapshot WHERE brand_id = ?",
      [brandId],
    );
    const failed = await generateReport(db, owner, {
      action: "generate-report",
      brandId,
      operationId: randomUUID(),
      retestId: retest.retest.id,
      before: shared.before,
      after: shared.after,
      locale: "en",
      metric: "recommendation_rate",
      brandName: "己品牌",
    }, clock, { env: storageEnv, storage: failingStorage(), now: new Date(time) });
    assert.equal(failed.error, "SERVICE_UNAVAILABLE");
    const [afterFailure] = await queryWithParameters(
      db,
      "SELECT count(*) AS n FROM report_snapshot WHERE brand_id = ?",
      [brandId],
    );
    assert.equal(Number(afterFailure.n), Number(beforeFailure[0].n));
    for (const [key, body] of firstBytes) assert.deepEqual(storage.objects.get(key), body);
  });
}
