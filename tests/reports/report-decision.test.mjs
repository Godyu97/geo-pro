import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { saveReportDecisionSchema } from "../../src/features/reports/contracts.ts";
import {
  listBrandDecisions,
  readSnapshot,
  readSnapshotDecisions,
  saveReportDecision,
} from "../../src/features/reports/commands.ts";
import { ReportDao } from "../../src/features/reports/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import en from "../../src/lib/i18n/messages/en.json" with { type: "json" };
import zhCN from "../../src/lib/i18n/messages/zh-CN.json" with { type: "json" };
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";
import { saveComparisonFixture, saveLegacySnapshot } from "./saved-observations.mjs";
import {
  generateSavedSnapshot,
  requestSavedComparison,
} from "../../src/features/reports/saved-retest.ts";

const time = "2026-11-20T12:00:00.000Z";
const clock = () => time;
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
        sha256: createHash("sha256").update(copy).digest("hex"),
        contentType,
      };
    },
    async getObject({ key }) {
      const body = objects.get(key);
      if (!body) return { ok: false, status: "failed", code: "unavailable" };
      return { ok: true, body, byteSize: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") };
    },
    async deleteObject() {
      return { ok: true };
    },
    async presignGet() {
      return { ok: false, status: "failed", code: "unavailable" };
    },
  };
}

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(
    kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json",
    "utf8",
  ));
  return journal.entries.at(-2).tag;
}

function digests(storage) {
  return [...storage.objects.entries()].map(([key, body]) => [key, createHash("sha256").update(body).digest("hex")]);
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Report owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function setup(t, kind) {
  const fixture = await testDatabase(kind, { migrateNow: false });
  t.after(() => fixture.cleanup());
  const db = fixture.connection;
  await migrateThrough(db, previousTag(kind));
  execFileSync("pnpm", ["db:migrate"], {
    env: { ...process.env, ...fixture.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [owner, outsider] = await Promise.all([account(db), account(db)]);
  const brands = new BrandDao(db);
  const brandId = randomUUID();
  await brands.insertBrand(owner, brandId, time);
  await brands.insertVersion(brandId, 1, {
    name: "己品牌",
    description: "Synthetic brand for report decisions",
    website: "https://ji.example.com",
    aliases: ["己"],
    region: "CN",
    language: "zh-CN",
    competitors: [],
    questions: [],
  }, time);
  return { db, owner, outsider, brandId };
}

async function snapshotFile(db, snapshotId) {
  const [row] = await queryWithParameters(
    db,
    `SELECT json_sha256 AS "jsonSha256", html_sha256 AS "htmlSha256",
      json_bytes AS "jsonBytes", html_bytes AS "htmlBytes"
     FROM report_snapshot WHERE id = ?`,
    [snapshotId],
  );
  return row;
}

async function decisionCount(db, brandId) {
  const [row] = await queryWithParameters(
    db,
    `SELECT count(*) AS "count" FROM report_decision WHERE brand_id = ?`,
    [brandId],
  );
  return Number(row.count);
}

test("decision messages name the four actions in both languages and errors stay generic", () => {
  for (const catalog of [zhCN.reports, en.reports]) {
    assert.match(catalog.decisionContinueContent, /\S/);
    assert.match(catalog.decisionSupplementEvidence, /\S/);
    assert.match(catalog.decisionContinueObservation, /\S/);
    assert.match(catalog.decisionStop, /\S/);
    assert.equal(catalog.NOT_FOUND.includes("declined"), false);
    assert.equal(catalog.NOT_FOUND.includes("观察下降"), false);
    assert.equal(catalog.NO_COMPARISON.includes("declined"), false);
    assert.equal(catalog.NO_COMPARISON.includes("观察下降"), false);
  }
  assert.equal(saveReportDecisionSchema.safeParse({
    brandId: randomUUID(),
    snapshotId: randomUUID(),
    action: "rewrite-conclusion",
  }).success, false);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: next decision keeps the declined snapshot bytes`, async (t) => {
    const { db, owner, outsider, brandId } = await setup(t, kind);
    const storage = memoryStorage();
    const options = { env: storageEnv, storage, now: new Date(time) };
    await saveComparisonFixture(db, owner, brandId);
    const saved = await requestSavedComparison(db, owner, {
      brandId,
      operationId: randomUUID(),
      intent: "diagnostic",
      track: "model_api",
      timezone: "Asia/Shanghai",
      beforeStart: "2026-11-01",
      beforeEnd: "2026-11-08",
      afterStart: "2026-11-09",
      afterEnd: "2026-11-16",
      locale: "zh-CN",
    }, clock);
    assert.equal(saved.error, undefined);
    const report = await generateSavedSnapshot(db, owner, {
      brandId,
      operationId: randomUUID(),
      retestId: saved.retest.id,
      locale: "zh-CN",
    }, clock, options);
    assert.equal(report.error, undefined);
    const opened = await readSnapshot(db, owner, report.snapshot.id, options);
    assert.equal(opened.error, undefined);
    const beforeJson = opened.json;
    const beforeHtml = opened.html;
    const beforeFile = await snapshotFile(db, report.snapshot.id);
    const beforeObjects = digests(storage);
    const document = JSON.parse(beforeJson);
    assert.equal(document.comparisons.mention_rate.conclusion, "declined");
    assert.match(beforeHtml, /观察下降/);
    assert.equal(beforeHtml.includes("无效果"), false);

    const times = [
      "2026-11-26T01:00:00.000Z",
      "2026-11-26T01:05:00.000Z",
      "2026-11-26T02:00:00.000Z",
    ];
    let tick = 0;
    const decisionClock = () => times[tick++];
    const input = {
      brandId,
      snapshotId: report.snapshot.id,
      action: "continue_observation",
    };
    const first = await saveReportDecision(db, owner, input, decisionClock, options);
    assert.equal(first.error, undefined);
    assert.equal(first.decisions.length, 1);
    assert.equal(first.decisions[0].action, "continue_observation");
    assert.equal(first.decisions[0].decidedBy, owner);
    assert.equal(first.decisions[0].decidedAt, times[0]);
    assert.deepEqual(Object.keys(first.decisions[0]).sort(), ["action", "decidedAt", "decidedBy", "id", "snapshotId"]);
    assert.equal(JSON.stringify(first).includes("declined"), false);
    assert.equal(JSON.stringify(first).includes("观察下降"), false);
    assert.equal(JSON.stringify(first).includes(document.next_action), false);

    const repeat = await saveReportDecision(db, owner, input, decisionClock, options);
    assert.equal(repeat.error, undefined);
    assert.equal(repeat.decisions.length, 1);
    assert.equal(repeat.decisions[0].id, first.decisions[0].id);
    assert.equal(repeat.decisions[0].decidedAt, times[0]);
    assert.equal(await decisionCount(db, brandId), 1);

    const changed = await saveReportDecision(db, owner, {
      ...input,
      action: "supplement_evidence",
    }, decisionClock, options);
    assert.equal(changed.error, undefined);
    assert.equal(changed.decisions.length, 2);
    assert.deepEqual(changed.decisions.map((row) => row.action), ["continue_observation", "supplement_evidence"]);
    assert.ok(changed.decisions[0].decidedAt < changed.decisions[1].decidedAt);
    assert.notEqual(changed.decisions[0].id, changed.decisions[1].id);
    assert.equal(await decisionCount(db, brandId), 2);

    const again = await readSnapshot(db, owner, report.snapshot.id, options);
    assert.equal(again.json, beforeJson);
    assert.equal(again.html, beforeHtml);
    assert.equal(JSON.parse(again.json).comparisons.mention_rate.conclusion, "declined");
    const afterFile = await snapshotFile(db, report.snapshot.id);
    assert.deepEqual(afterFile, beforeFile);
    assert.deepEqual(digests(storage), beforeObjects);
    t.diagnostic(
      `snapshot ${report.snapshot.id} json ${beforeFile.jsonSha256} html ${beforeFile.htmlSha256}; decisions ${changed.decisions.map((row) => `${row.id} ${row.action} ${row.decidedAt}`).join(" | ")}`,
    );

    const explain = kind === "sqlite" ? "EXPLAIN QUERY PLAN" : "EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF)";
    const plan = await queryWithParameters(
      db,
      `${explain} SELECT id, action, decided_at FROM report_decision
       WHERE brand_id = ? AND owner_id = ? AND snapshot_id IN (?, ?)
       ORDER BY decided_at ASC, id ASC`,
      [brandId, owner, report.snapshot.id, randomUUID()],
    );
    const planText = plan.map((row) => row.detail ?? row["QUERY PLAN"]).join("\n");
    t.diagnostic(`decision list plan: ${planText}`);
    const indexName = kind === "sqlite"
      ? await queryWithParameters(db, `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'report_decision_brand_idx'`)
      : await queryWithParameters(db, `SELECT indexname AS name FROM pg_indexes WHERE indexname = 'report_decision_brand_idx'`);
    assert.equal(indexName.length, 1);

    const listed = await listBrandDecisions(db, owner, brandId, [report.snapshot.id]);
    assert.equal(listed.error, undefined);
    assert.equal(listed.decisions.length, 2);
    const outsiderRead = await readSnapshotDecisions(db, outsider, report.snapshot.id);
    const outsiderWrite = await saveReportDecision(db, outsider, input, decisionClock, options);
    const outsiderList = await listBrandDecisions(db, outsider, brandId, [report.snapshot.id]);
    for (const denied of [outsiderRead, outsiderWrite, outsiderList]) {
      assert.deepEqual(denied, { error: "NOT_FOUND" });
      const body = JSON.stringify(denied);
      assert.equal(body.includes("declined"), false);
      assert.equal(body.includes("观察下降"), false);
      assert.equal(body.includes("continue_observation"), false);
      assert.equal(body.includes("supplement_evidence"), false);
      assert.equal(body.includes("己品牌"), false);
    }
    assert.equal(await decisionCount(db, brandId), 2);
    const missing = await saveReportDecision(db, owner, {
      ...input,
      snapshotId: randomUUID(),
    }, decisionClock, options);
    assert.deepEqual(missing, { error: "NOT_FOUND" });

    const retestId = randomUUID();
    await new ReportDao(db).insertRetest({
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
    const legacy = await saveLegacySnapshot(db, owner, brandId, retestId);
    const legacyFile = await snapshotFile(db, legacy.id);
    const noComparison = await saveReportDecision(db, owner, {
      brandId,
      snapshotId: legacy.id,
      action: "stop",
    }, decisionClock, options);
    assert.deepEqual(noComparison, { error: "NO_COMPARISON" });
    assert.equal(JSON.stringify(noComparison).includes("declined"), false);
    assert.deepEqual(await snapshotFile(db, legacy.id), legacyFile);
    assert.equal(await decisionCount(db, brandId), 2);

    await new PurgeDao(db).clearContents({ ownerId: owner, brandId }, time);
    assert.equal(await decisionCount(db, brandId), 0);
  });
}
