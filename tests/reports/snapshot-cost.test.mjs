import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { summarizeCostGroups, samplingCostGroupsQuery } from "../../src/features/reports/cost.ts";
import { presentSnapshotCost } from "../../src/features/reports/cost-copy.ts";
import {
  generateReport,
  readSnapshot,
  requestRetest,
  reviseReport,
  snapshotViews,
} from "../../src/features/reports/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

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
const windows = {
  before: { start: "2026-11-01T00:00:00.000Z", endExclusive: "2026-11-02T00:00:00.000Z" },
  after: { start: "2026-11-10T00:00:00.000Z", endExclusive: "2026-11-11T00:00:00.000Z" },
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

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Report owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function sample(overrides = {}) {
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

function reportWindows(beforeStart, beforeEnd, afterStart, afterEnd) {
  return {
    before: { start: beforeStart, endExclusive: beforeEnd, samples: [sample()] },
    after: { start: afterStart, endExclusive: afterEnd, samples: [sample({ numerator: 1 })] },
  };
}

async function brand(db, owner, name) {
  const id = randomUUID();
  const brands = new BrandDao(db);
  await brands.insertBrand(owner, id, time);
  await brands.insertVersion(id, 1, {
    name,
    description: "Synthetic brand for snapshot cost",
    website: "https://cost.example.com",
    aliases: [],
    region: "CN",
    language: "zh-CN",
    competitors: [],
    questions: [],
  }, time);
  return id;
}

async function insertRun(db, ownerId, brandId, createdAt) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    `INSERT INTO monitoring_run (
      id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
      repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
      requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
      status, sampling_complete, created_at
    ) VALUES (?, ?, ?, ?, ?, 'model_api', ?, 1, 1, 1, 0, 1, 1, 'CN', 'zh-CN', 'off', 'CNY', 1, 1, 0, 'succeeded', 1, ?)`,
    [id, brandId, ownerId, randomUUID(), "a".repeat(64), randomUUID(), createdAt],
  );
  return id;
}

async function insertAttempt(db, ownerId, brandId, createdAt, cost) {
  const runId = await insertRun(db, ownerId, brandId, createdAt);
  const slotId = randomUUID();
  await queryWithParameters(
    db,
    `INSERT INTO monitoring_slot (
      id, run_id, brand_id, question_id, natural_question, channel_id, channel_version,
      repeat_index, reservation_id, status, created_at, adopted_attempt_id, late
    ) VALUES (?, ?, ?, ?, 0, ?, 1, 1, NULL, 'failed', ?, NULL, 0)`,
    [slotId, runId, brandId, randomUUID(), randomUUID(), createdAt],
  );
  await queryWithParameters(
    db,
    `INSERT INTO monitoring_attempt (
      id, slot_id, run_id, brand_id, kind, ordinal, transport, synthetic, disposition, raw_text,
      currency, upper_minor, actual_minor, cost_state, quota_attempt_id, late, receipt, created_at
    ) VALUES (?, ?, ?, ?, 'sampling', 1, 'official_api', 0, 'safe_failure', NULL, ?, ?, ?, ?, NULL, 0, NULL, ?)`,
    [randomUUID(), slotId, runId, brandId, cost.currency, cost.upperMinor, cost.actualMinor, cost.costState, createdAt],
  );
}

async function openRetest(db, owner, brandId, locale, range) {
  const retest = await requestRetest(db, owner, {
    action: "request-retest",
    brandId,
    operationId: randomUUID(),
    kind: "diagnostic",
    intent: "diagnostic",
    track: "model_api",
    timezone: "Asia/Shanghai",
    entityVersion: 1,
    before: range.before,
    after: range.after,
    locale,
    metric: "recommendation_rate",
  }, clock);
  assert.equal(retest.error, undefined);
  return retest.retest.id;
}

function costSection(html) {
  const start = html.indexOf('<section id="snapshot-cost">');
  const end = html.indexOf("</section>", start);
  return html.slice(start, end).replace(/<[^>]+>/g, "");
}

test("known fees sum by currency and pending fees are not written as zero", () => {
  const summary = summarizeCostGroups([
    { costState: "known", currency: "CNY", actualMinor: 1, attemptCount: 1 },
    { costState: "known", currency: "CNY", actualMinor: 2, attemptCount: 1 },
    { costState: "known", currency: "USD", actualMinor: 4, attemptCount: 1 },
    { costState: "unknown", currency: "CNY", actualMinor: null, attemptCount: 1 },
    { costState: "pending", currency: null, actualMinor: null, attemptCount: 1 },
    { costState: "known", currency: null, actualMinor: 8, attemptCount: 1 },
  ]);
  assert.deepEqual(summary, {
    status: "summarized",
    known: [
      { currency: "CNY", minor: 3 },
      { currency: "USD", minor: 4 },
    ],
    pending_count: 3,
  });
  assert.equal(JSON.stringify(summary).includes('"minor":0'), false);
});

test("an empty sampling window is N/A rather than zero cost", () => {
  const summary = summarizeCostGroups([]);
  assert.deepEqual(summary, { status: "not_applicable", reason: "no_sampling_cost" });
  const zh = presentSnapshotCost("zh-CN", summary, { status: "not_applicable", reason: "unrecorded" });
  const en = presentSnapshotCost("en", summary, { status: "not_applicable", reason: "unrecorded" });
  assert.match(zh.reason, /窗口内没有可关联的采样费用/);
  assert.match(zh.laborReason, /未记录人工工时/);
  assert.match(en.reason, /No sampling cost can be associated/);
  assert.match(en.laborReason, /not recorded/i);
  for (const lines of [zh, en]) {
    assert.equal(/[0-9]/.test(`${lines.known} ${lines.pending} ${lines.reason} ${lines.labor} ${lines.laborReason}`), false);
    assert.equal(lines.known.includes("not_applicable"), false);
    assert.equal(lines.laborReason.includes("unrecorded"), false);
  }
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: snapshot separates known cost, pending cost, and unrecorded labor`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const owner = await account(db);
    const outsider = await account(db);
    const brandId = await brand(db, owner, "费用品牌");
    const otherBrand = await brand(db, outsider, "其他品牌");
    const storage = memoryStorage();
    const options = { env: storageEnv, storage, now: new Date(time) };
    const [quotaBefore] = await queryWithParameters(db, 'SELECT COUNT(*) AS "total" FROM quota_attempt', []);

    await insertAttempt(db, owner, brandId, "2026-11-01T08:00:00.000Z", {
      currency: "CNY", upperMinor: 1, actualMinor: 1, costState: "known",
    });
    await insertAttempt(db, owner, brandId, "2026-11-10T08:00:00.000Z", {
      currency: "CNY", upperMinor: 2, actualMinor: 2, costState: "known",
    });
    await insertAttempt(db, owner, brandId, "2026-11-10T09:00:00.000Z", {
      currency: "CNY", upperMinor: 5, actualMinor: null, costState: "unknown",
    });
    await insertAttempt(db, owner, brandId, "2026-11-01T10:00:00.000Z", {
      currency: null, upperMinor: null, actualMinor: null, costState: "none",
    });
    await insertAttempt(db, owner, brandId, "2026-11-05T08:00:00.000Z", {
      currency: "CNY", upperMinor: 9, actualMinor: 9, costState: "known",
    });
    await insertAttempt(db, owner, brandId, "2026-11-02T00:00:00.000Z", {
      currency: "CNY", upperMinor: 50, actualMinor: 50, costState: "known",
    });
    await insertAttempt(db, outsider, otherBrand, "2026-11-01T11:00:00.000Z", {
      currency: "CNY", upperMinor: 8, actualMinor: 8, costState: "known",
    });

    const range = reportWindows(windows.before.start, windows.before.endExclusive, windows.after.start, windows.after.endExclusive);
    const zhRetest = await openRetest(db, owner, brandId, "zh-CN", range);
    const zhReport = await generateReport(db, owner, {
      action: "generate-report",
      brandId,
      operationId: randomUUID(),
      retestId: zhRetest,
      before: range.before,
      after: range.after,
      locale: "zh-CN",
      metric: "recommendation_rate",
      brandName: "费用品牌",
    }, clock, options);
    assert.equal(zhReport.error, undefined);
    const zhOpened = await readSnapshot(db, owner, zhReport.snapshot.id, options);
    assert.equal(zhOpened.error, undefined);
    const zhJson = JSON.parse(zhOpened.json);
    assert.deepEqual(zhJson.cost, {
      status: "summarized",
      known: [{ currency: "CNY", minor: 3 }],
      pending_count: 1,
    });
    assert.deepEqual(zhJson.labor, { status: "not_applicable", reason: "unrecorded" });
    const zhLines = presentSnapshotCost("zh-CN", zhJson.cost, zhJson.labor);
    const enLines = presentSnapshotCost("en", zhJson.cost, zhJson.labor);
    assert.match(zhLines.known, /CNY 3 分/);
    assert.match(enLines.known, /CNY 3 minor units/);
    assert.match(zhLines.pending, /1 条/);
    assert.match(enLines.pending, /1 item pending reconciliation/);
    assert.equal(enLines.known.includes("已知"), false);
    assert.equal(zhLines.known.includes("Known"), false);
    const zhSection = costSection(zhOpened.html);
    assert.ok(zhSection.includes(zhLines.known));
    assert.ok(zhSection.includes(zhLines.pending));
    assert.ok(zhSection.includes(zhLines.laborReason));
    assert.equal(zhSection.includes("unrecorded"), false);
    assert.equal(zhSection.includes("summarized"), false);

    const enRetest = await openRetest(db, owner, brandId, "en", range);
    const enReport = await generateReport(db, owner, {
      action: "generate-report",
      brandId,
      operationId: randomUUID(),
      retestId: enRetest,
      before: range.before,
      after: range.after,
      locale: "en",
      metric: "recommendation_rate",
      brandName: "费用品牌",
    }, clock, options);
    assert.equal(enReport.error, undefined);
    const enOpened = await readSnapshot(db, owner, enReport.snapshot.id, options);
    const enJson = JSON.parse(enOpened.json);
    assert.equal(enJson.cost.known[0].minor, zhJson.cost.known[0].minor);
    assert.equal(enJson.cost.pending_count, zhJson.cost.pending_count);
    const enSection = costSection(enOpened.html);
    assert.match(enSection, /CNY 3 minor units/);
    assert.match(enSection, /Labor hours were not recorded/);
    assert.equal(enSection.includes("未记录人工工时"), false);
    assert.equal(enSection.includes("not_applicable"), false);

    const views = await snapshotViews(db, owner, [zhReport.snapshot, enReport.snapshot], options);
    assert.equal(views.get(zhReport.snapshot.id).cost.cost.known[0].minor, 3);
    assert.equal(views.get(enReport.snapshot.id).cost.cost.pending_count, 1);

    const emptyRange = reportWindows(
      "2020-01-01T00:00:00.000Z",
      "2020-01-02T00:00:00.000Z",
      "2020-01-03T00:00:00.000Z",
      "2020-01-04T00:00:00.000Z",
    );
    const emptyRetest = await openRetest(db, owner, brandId, "zh-CN", emptyRange);
    const emptyReport = await generateReport(db, owner, {
      action: "generate-report",
      brandId,
      operationId: randomUUID(),
      retestId: emptyRetest,
      before: emptyRange.before,
      after: emptyRange.after,
      locale: "zh-CN",
      metric: "recommendation_rate",
      brandName: "费用品牌",
    }, clock, options);
    assert.equal(emptyReport.error, undefined);
    const emptyOpened = await readSnapshot(db, owner, emptyReport.snapshot.id, options);
    const emptyJson = JSON.parse(emptyOpened.json);
    assert.deepEqual(emptyJson.cost, { status: "not_applicable", reason: "no_sampling_cost" });
    assert.deepEqual(emptyJson.labor, { status: "not_applicable", reason: "unrecorded" });
    const emptySection = costSection(emptyOpened.html);
    assert.match(emptySection, /窗口内没有可关联的采样费用/);
    assert.match(emptySection, /未记录人工工时/);
    assert.equal(/[0-9]/.test(emptySection), false);
    assert.equal(emptyOpened.json.includes('"minor":0'), false);
    assert.equal(emptyOpened.json.includes('"pending_count":0'), false);

    const originalJson = zhOpened.json;
    const originalHtml = zhOpened.html;
    await insertAttempt(db, owner, brandId, "2026-11-10T12:00:00.000Z", {
      currency: "CNY", upperMinor: 4, actualMinor: 4, costState: "known",
    });
    await insertAttempt(db, owner, brandId, "2026-11-01T12:00:00.000Z", {
      currency: "CNY", upperMinor: 6, actualMinor: null, costState: "pending",
    });
    const revised = await reviseReport(db, owner, {
      action: "revise-report",
      brandId,
      operationId: randomUUID(),
      snapshotId: zhReport.snapshot.id,
      before: range.before,
      after: range.after,
      locale: "zh-CN",
      metric: "recommendation_rate",
      note: "更正标签",
    }, clock, options);
    assert.equal(revised.error, undefined);
    const previous = await readSnapshot(db, owner, zhReport.snapshot.id, options);
    assert.equal(previous.json, originalJson);
    assert.equal(previous.html, originalHtml);
    const nextOpened = await readSnapshot(db, owner, revised.snapshot.id, options);
    const nextJson = JSON.parse(nextOpened.json);
    assert.equal(nextJson.cost.known[0].minor, 7);
    assert.equal(nextJson.cost.pending_count, 2);
    assert.notEqual(nextJson.report_id, zhJson.report_id);
    assert.equal(nextOpened.json === originalJson, false);

    const [quotaAfter] = await queryWithParameters(db, 'SELECT COUNT(*) AS "total" FROM quota_attempt', []);
    assert.equal(Number(quotaAfter.total), Number(quotaBefore.total));

    if (db.kind === "postgresql") await db.query("ANALYZE monitoring_attempt");
    const planQuery = samplingCostGroupsQuery(brandId, windows);
    const plan = JSON.stringify(await queryWithParameters(
      db,
      `${db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN "}${planQuery.sql}`,
      planQuery.values,
    ));
    assert.match(plan, /monitoring_attempt/);
    if (db.kind === "sqlite") assert.match(plan, /monitoring_attempt_brand_idx/);
  });
}
