import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { ReportDao } from "../../src/features/reports/dao.ts";
import {
  listReports,
  readSnapshot,
  referencedObservationIds,
  snapshotViews,
} from "../../src/features/reports/commands.ts";
import { saveStoredObject } from "../../src/features/stored-objects/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-25T09:00:00.000Z";
const storageEnv = {
  S3_ENDPOINT: "http://127.0.0.1:9",
  S3_REGION: "us-east-1",
  S3_BUCKET: "app-files",
  S3_ACCESS_KEY_ID: "local-app",
  S3_SECRET_ACCESS_KEY: "s3-secret-not-for-logs",
  S3_FORCE_PATH_STYLE: "true",
};
const brandFields = {
  name: "源证据品牌",
  description: "Synthetic brand for source-missing snapshots",
  website: "https://source-missing.example",
  aliases: [],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function memoryStorage() {
  const objects = new Map();
  return {
    objects,
    async putAndReadBack({ key, body, contentType }) {
      const copy = Uint8Array.from(body);
      objects.set(key, copy);
      return {
        ok: true,
        status: "ready",
        bucket: "app-files",
        key,
        byteSize: copy.byteLength,
        sha256: sha(copy),
        contentType,
      };
    },
    async getObject({ key }) {
      const body = objects.get(key);
      if (!body) return { ok: false, status: "failed", code: "unavailable" };
      return { ok: true, body, byteSize: body.byteLength, sha256: sha(body) };
    },
    async deleteObject() {
      return { ok: true };
    },
    async presignGet() {
      return { ok: false, status: "failed", code: "unavailable" };
    },
  };
}

function trace(connection) {
  const queries = [];
  const wrap = (current) => ({
    ...current,
    query(sql, values) {
      queries.push({ sql, values: values ?? [] });
      return current.query(sql, values);
    },
    transaction(work) {
      return current.transaction((tx) => work(wrap(tx)));
    },
    savepoint(work) {
      return current.savepoint((inner) => work(wrap(inner)));
    },
  });
  return { connection: wrap(connection), queries };
}

function storageBytes(storage) {
  return [...storage.objects.entries()].map(([key, body]) => [key, Buffer.from(body).toString("hex")]);
}

test("messages name cleared source evidence without claiming the file changed", () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  for (const key of ["snapshotSourceMissing", "snapshotSourceMissingCountOne", "snapshotSourceMissingCount"]) {
    assert.match(zhCN.reports[key], /部分源证据已清除，历史快照不可复核原证据/);
    assert.match(en.reports[key], /cannot be rechecked against the original evidence/);
    assert.equal(zhCN.reports[key].includes("sha256"), false);
    assert.equal(en.reports[key].includes("report.json"), false);
  }
  assert.match(zhCN.reports.snapshotSourceMissingCount, /\{count\}/);
  assert.match(en.reports.snapshotSourceMissingCountOne, /\{count\}/);
});

test("observation ids are read from report-v4 comparisons and historical query lists", () => {
  const current = {
    schema_version: "report-v4",
    comparisons: {
      mention_rate: { queries: [{ before: { observation_ids: ["keep", "gone"] }, after: { observation_ids: ["keep"] } }] },
      recommendation_rate: { queries: [{ before: { observation_ids: ["later"] }, after: { observation_ids: [] } }] },
      official_site_citation_rate: { queries: [] },
    },
  };
  const historical = {
    schema_version: "report-v3",
    metric: "recommendation_rate",
    queries: [{ before: { observation_ids: ["old-before"] }, after: { observation_ids: ["old-after", "gone"] } }],
  };
  assert.deepEqual(referencedObservationIds(current).sort(), ["gone", "keep", "later"]);
  assert.deepEqual(referencedObservationIds(historical).sort(), ["gone", "old-after", "old-before"]);
  assert.deepEqual(referencedObservationIds({ schema_version: "report-v3", metric: "mention_rate" }), []);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: deleted observations mark snapshot source missing without rewriting bytes`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
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
    const owner = await account("Source owner");
    const outsider = await account("Source outsider");
    const brands = new BrandDao(db);
    const brandId = randomUUID();
    const otherBrandId = randomUUID();
    await brands.insertBrand(owner, brandId, time);
    await brands.insertVersion(brandId, 1, brandFields, time);
    await brands.insertBrand(outsider, otherBrandId, time);
    await brands.insertVersion(otherBrandId, 1, { ...brandFields, name: "其他品牌" }, time);

    const ids = {
      keepA: randomUUID(),
      keepB: randomUUID(),
      dropC: randomUUID(),
      dropD: randomUUID(),
      foreignId: randomUUID(),
    };
    const insertObservation = async (id, observationBrandId, observationOwnerId) => {
      await queryWithParameters(
        db,
        `INSERT INTO answer_observation (
          id, brand_id, owner_id, source_mode, capture_method, question_text, answer_text, fingerprint,
          captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
          evidence_state, created_at, target_region, observed_region, new_session, product_mode
        ) VALUES (?, ?, ?, 'model_api', 'official_api', '合成问题', '合成回答', ?, ?, 'CN', 'zh-CN', 'unknown', 1,
          'complete', 'complete', ?, 'CN', 'unknown', 'unknown', 'unknown')`,
        [id, observationBrandId, observationOwnerId, "b".repeat(64), time, time],
      );
    };
    await insertObservation(ids.keepA, brandId, owner);
    await insertObservation(ids.keepB, brandId, owner);
    await insertObservation(ids.dropC, brandId, owner);
    await insertObservation(ids.dropD, brandId, owner);
    await insertObservation(ids.foreignId, otherBrandId, outsider);

    const side = (observationIds) => ({ numerator: 1, denominator: 1, rate: 1, observation_ids: observationIds });
    const currentDocument = {
      schema_version: "report-v4",
      delta_marker: 12.5,
      comparisons: {
        mention_rate: { queries: [{ query_id: "q1", before: side([ids.keepA, ids.dropC]), after: side([ids.keepB]) }] },
        recommendation_rate: { queries: [{ query_id: "q1", before: side([ids.keepA]), after: side([ids.dropD]) }] },
        official_site_citation_rate: { queries: [{ query_id: "q2", before: side([ids.dropC]), after: side([ids.keepB, ids.dropD]) }] },
      },
    };
    const historicalDocument = {
      schema_version: "report-v3",
      metric: "recommendation_rate",
      delta_marker: 7,
      queries: [{ query_id: "q-old", before: side([ids.keepA]), after: side([ids.dropD]) }],
      cost: { status: "summarized", known: [{ currency: "CNY", minor: 3 }], pending_count: 1 },
      labor: { status: "not_applicable", reason: "unrecorded" },
    };
    const flaggedDocument = {
      schema_version: "report-v3",
      metric: "mention_rate",
      queries: [{ query_id: "q-flag", before: side([ids.keepA]), after: side([ids.keepB]) }],
    };
    const foreignDocument = {
      schema_version: "report-v3",
      metric: "mention_rate",
      queries: [{ query_id: "q-foreign", before: side([ids.foreignId]), after: side([]) }],
    };
    const extraIds = Array.from({ length: 100 }, () => randomUUID());
    const chunkDocument = {
      schema_version: "report-v3",
      metric: "recommendation_rate",
      queries: [{ query_id: "q-chunk", before: side([ids.keepA, ...extraIds.slice(0, 50)]), after: side(extraIds.slice(50)) }],
    };

    const dao = new ReportDao(db);
    const retestId = randomUUID();
    await dao.insertRetest({
      id: retestId,
      brandId,
      ownerId: owner,
      kind: "diagnostic",
      status: "completed",
      intent: "diagnostic",
      track: "model_api",
      timezone: "Asia/Shanghai",
      entityVersion: 1,
      beforeRunId: null,
      afterRunId: null,
      publicationId: null,
      effectiveAt: null,
      operationId: randomUUID(),
      comparisonJson: null,
      blockReason: null,
      createdAt: time,
      updatedAt: time,
    });

    const storeText = async (fileName, contentType, text) => {
      const saved = await saveStoredObject(db, {
        actorId: owner,
        brandId,
        class: "report-snapshot",
        visibility: "internal",
        fileName,
        contentType,
        body: new TextEncoder().encode(text),
      }, options);
      assert.equal(saved.ok, true);
      assert.equal(saved.sha256, sha(text));
      return saved;
    };
    const currentJson = JSON.stringify(currentDocument);
    const currentHtml = "<!doctype html><p>current-marker 12.5</p>";
    const currentJsonObject = await storeText("report.json", "application/json", currentJson);
    const currentHtmlObject = await storeText("report.html", "text/html", currentHtml);
    const currentId = randomUUID();
    await dao.insertSnapshot({
      id: currentId,
      brandId,
      ownerId: owner,
      retestId,
      status: "created",
      grade: "exploratory",
      intent: "diagnostic",
      loopCompleted: 0,
      predecessorId: null,
      entityVersion: 1,
      timezone: "Asia/Shanghai",
      locale: "zh-CN",
      sourceMissing: 0,
      jsonBytes: "",
      htmlBytes: "",
      jsonSha256: currentJsonObject.sha256,
      htmlSha256: currentHtmlObject.sha256,
      operationId: randomUUID(),
      createdAt: "2026-11-25T09:00:04.000Z",
      htmlObjectId: currentHtmlObject.id,
      jsonObjectId: currentJsonObject.id,
    });

    const insertInline = async (document, sourceMissing, createdAt) => {
      const json = JSON.stringify(document);
      const html = `<!doctype html><p>${document.metric}-marker</p>`;
      const id = randomUUID();
      await dao.insertSnapshot({
        id,
        brandId,
        ownerId: owner,
        retestId,
        status: "created",
        grade: "exploratory",
        intent: "diagnostic",
        loopCompleted: 0,
        predecessorId: null,
        entityVersion: 1,
        timezone: "Asia/Shanghai",
        locale: "zh-CN",
        sourceMissing,
        jsonBytes: json,
        htmlBytes: html,
        jsonSha256: sha(json),
        htmlSha256: sha(html),
        operationId: randomUUID(),
        createdAt,
        htmlObjectId: null,
        jsonObjectId: null,
      });
      return { id, json, html };
    };
    const historical = await insertInline(historicalDocument, 0, "2026-11-25T09:00:03.000Z");
    const flagged = await insertInline(flaggedDocument, 1, "2026-11-25T09:00:02.000Z");
    const foreign = await insertInline(foreignDocument, 0, "2026-11-25T09:00:01.000Z");
    const chunk = await insertInline(chunkDocument, 0, "2026-11-25T09:00:00.000Z");
    const preservedObjects = storageBytes(storage);

    const before = await listReports(db, owner, brandId, 20, options);
    assert.equal(before.error, undefined);
    assert.equal(before.sources[currentId].sourceMissing, false);
    assert.equal(before.sources[currentId].missingObservationCount, 0);
    assert.equal(before.sources[flagged.id].sourceMissing, true);
    assert.equal(before.sources[flagged.id].missingObservationCount, 0);
    assert.equal(before.sources[foreign.id].sourceMissing, true);
    assert.equal(before.sources[foreign.id].missingObservationCount, 1);
    assert.deepEqual(Object.keys(before.sources[foreign.id]).sort(), ["missingObservationCount", "sourceMissing"]);
    const foreignRow = await queryWithParameters(db, "SELECT id FROM answer_observation WHERE id = ?", [ids.foreignId]);
    assert.equal(foreignRow.length, 1);

    await queryWithParameters(db, "DELETE FROM answer_observation WHERE id IN (?, ?)", [ids.dropC, ids.dropD]);
    const traced = trace(db);
    const listed = await listReports(traced.connection, owner, brandId, 20, options);
    const observationQueries = traced.queries.filter((query) => query.sql.includes("FROM answer_observation"));
    const referenced = new Set([
      ...referencedObservationIds(currentDocument),
      ...referencedObservationIds(historicalDocument),
      ...referencedObservationIds(flaggedDocument),
      ...referencedObservationIds(foreignDocument),
      ...referencedObservationIds(chunkDocument),
    ]);
    assert.equal(observationQueries.length, Math.ceil(referenced.size / 100));
    assert.ok(observationQueries.length > 1);
    for (const query of observationQueries) {
      assert.match(query.sql, /owner_id = \?|owner_id = \$1/);
      assert.match(query.sql, /brand_id = \?|brand_id = \$2/);
      assert.equal(query.values[0], owner);
      assert.equal(query.values[1], brandId);
    }
    assert.equal(observationQueries.some((query) => query.values.includes(ids.foreignId)), true);
    assert.equal(listed.sources[currentId].sourceMissing, true);
    assert.equal(listed.sources[currentId].missingObservationCount, 2);
    assert.equal(listed.sources[historical.id].sourceMissing, true);
    assert.equal(listed.sources[historical.id].missingObservationCount, 1);
    assert.equal(listed.sources[flagged.id].sourceMissing, true);
    assert.equal(listed.sources[flagged.id].missingObservationCount, 0);
    assert.equal(listed.sources[chunk.id].missingObservationCount, 100);
    assert.equal(listed.snapshots.find((row) => row.id === currentId).sourceMissing, 0);

    const views = await snapshotViews(db, owner, listed.snapshots, options);
    assert.equal(views.get(currentId).source.sourceMissing, true);
    assert.equal(views.get(currentId).source.missingObservationCount, 2);
    assert.equal(views.get(historical.id).metric, "recommendation_rate");
    assert.equal(views.get(historical.id).source.missingObservationCount, 1);

    const opened = await readSnapshot(db, owner, currentId, options);
    assert.equal(opened.json, currentJson);
    assert.equal(opened.html, currentHtml);
    assert.equal(JSON.parse(opened.json).delta_marker, 12.5);
    assert.equal(opened.source.sourceMissing, true);
    assert.equal(opened.source.missingObservationCount, 2);
    assert.equal(opened.snapshot.jsonSha256, currentJsonObject.sha256);
    assert.equal(opened.snapshot.htmlSha256, currentHtmlObject.sha256);
    assert.equal(opened.snapshot.sourceMissing, 0);
    const historicalOpened = await readSnapshot(db, owner, historical.id, options);
    assert.equal(historicalOpened.json, historical.json);
    assert.equal(historicalOpened.html, historical.html);
    assert.deepEqual(storageBytes(storage), preservedObjects);

    const [storedRow] = await queryWithParameters(
      db,
      `SELECT source_missing AS "sourceMissing", json_sha256 AS "jsonSha256", html_sha256 AS "htmlSha256",
        json_bytes AS "jsonBytes", html_bytes AS "htmlBytes"
       FROM report_snapshot WHERE id = ?`,
      [currentId],
    );
    assert.equal(storedRow.sourceMissing, 0);
    assert.equal(storedRow.jsonSha256, currentJsonObject.sha256);
    assert.equal(storedRow.htmlSha256, currentHtmlObject.sha256);
    assert.equal(storedRow.jsonBytes, "");
    assert.equal(storedRow.htmlBytes, "");

    await queryWithParameters(db, "DELETE FROM answer_observation WHERE brand_id = ?", [brandId]);
    const cleared = await readSnapshot(db, owner, currentId, options);
    assert.equal(cleared.json, currentJson);
    assert.equal(cleared.html, currentHtml);
    assert.equal(cleared.source.missingObservationCount, 4);
    assert.equal(cleared.snapshot.jsonSha256, currentJsonObject.sha256);

    const deniedTrace = trace(db);
    const denied = await readSnapshot(deniedTrace.connection, outsider, currentId, options);
    assert.equal(denied.error, "NOT_FOUND");
    assert.equal(deniedTrace.queries.some((query) => query.sql.includes("answer_observation")), false);
    const outsiderList = await listReports(db, outsider, brandId, 20, options);
    assert.equal(outsiderList.error, "NOT_FOUND");
    const otherList = await listReports(db, outsider, otherBrandId, 20, options);
    assert.equal(otherList.error, undefined);
    assert.equal(otherList.snapshots.length, 0);
    assert.deepEqual(otherList.sources, {});
  });
}
