import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import {
  generateReport,
  listReports,
  readSnapshot,
  requestRetest,
  reviseReport,
} from "../../src/features/reports/commands.ts";
import { compareWindows, computeD7DueAt, resolveLoopGate } from "../../src/features/reports/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

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

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Report owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
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
    before: {
      start: "2026-11-01T00:00:00.000Z",
      endExclusive: "2026-11-02T00:00:00.000Z",
      samples: beforeSamples,
    },
    after: {
      start: "2026-11-10T00:00:00.000Z",
      endExclusive: "2026-11-11T00:00:00.000Z",
      samples: afterSamples,
    },
  };
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
    description: "Synthetic brand for report retest",
    website: "https://ji.example.com",
    aliases: ["己"],
    region: "CN",
    language: "zh-CN",
    competitors: [],
    questions: [],
  }, time);
  return { db, owner, outsider, brandId, env: fixture.env };
}

test("pure rules: AC-M0-12-1 common three exclude modified", () => {
  const before = [
    sample({ queryId: "q1", queryVersion: "q1-v1", numerator: 0 }),
    sample({ queryId: "q2", queryVersion: "q2-v1", numerator: 0 }),
    sample({ queryId: "q3", queryVersion: "q3-v1", numerator: 0 }),
    sample({ queryId: "q4", queryVersion: "q4-v1", numerator: 0 }),
  ];
  const after = [
    sample({ queryId: "q1", queryVersion: "q1-v1", numerator: 1 }),
    sample({ queryId: "q2", queryVersion: "q2-v1", numerator: 0 }),
    sample({ queryId: "q3", queryVersion: "q3-v1", numerator: 1 }),
    sample({ queryId: "q4", queryVersion: "q4-v2", numerator: 1 }),
  ];
  const result = compareWindows(before, after);
  assert.equal(result.commonQueryCount, 3);
  assert.equal(result.grade, "exploratory");
  assert.ok(result.excluded.some((item) => item.reason === "modified" && item.queryId === "q4"));
  assert.equal(result.included.length, 3);
  // before 0/0/0 → 0; after 1/0/1 → 2/3; delta_pp = 66.666...
  assert.ok(Math.abs(result.deltaPp - ((2 / 3) * 100)) < 1e-9);
  assert.equal(result.causality, "not_established");
});

test("pure rules: AC-M0-12-2 loop gate without effective_at", () => {
  const gate = resolveLoopGate({ requestedIntent: "business_loop", effectiveAt: null });
  assert.equal(gate.allowedIntent, "diagnostic");
  assert.equal(gate.loopCompleted, false);
  assert.equal(gate.reason, "publication-not-verified");
});

test("pure rules: D+7 progress before due", () => {
  const progress = computeD7DueAt("2026-11-05T07:00:00.000Z", "Asia/Shanghai", "2026-11-08T00:00:00.000Z");
  assert.equal(progress.progressOnly, true);
  assert.ok(progress.remainingFullDays > 0);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: AC-M0-12-1/2/3 + ownership + purge`, async (t) => {
    const { db, owner, outsider, brandId } = await setup(t, kind);
    const storage = memoryStorage();
    const options = { env: storageEnv, storage, now: new Date(time) };
    const shared = windows(
      [
        sample({ queryId: "q1", queryVersion: "q1-v1", numerator: 0 }),
        sample({ queryId: "q2", queryVersion: "q2-v1", numerator: 0 }),
        sample({ queryId: "q3", queryVersion: "q3-v1", numerator: 0 }),
        sample({ queryId: "q4", queryVersion: "q4-v1", numerator: 0 }),
      ],
      [
        sample({ queryId: "q1", queryVersion: "q1-v1", numerator: 1 }),
        sample({ queryId: "q2", queryVersion: "q2-v1", numerator: 0 }),
        sample({ queryId: "q3", queryVersion: "q3-v1", numerator: 1 }),
        sample({ queryId: "q4", queryVersion: "q4-v2", numerator: 1 }),
      ],
    );

    // AC-M0-12-2: business_loop without verification becomes diagnostic
    const retest = await requestRetest(db, owner, {
      action: "request-retest",
      brandId,
      operationId: randomUUID(),
      kind: "exploratory",
      intent: "business_loop",
      track: "model_api",
      timezone: "Asia/Shanghai",
      entityVersion: 1,
      before: shared.before,
      after: shared.after,
      locale: "zh-CN",
      metric: "recommendation_rate",
    }, clock);
    assert.equal(retest.error, undefined);
    assert.equal(retest.retest.intent, "diagnostic");
    assert.equal(retest.loopCompleted, false);
    assert.equal(retest.comparison.commonQueryCount, 3);

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
    assert.equal(report.loopCompleted, false);
    assert.equal(report.snapshot.intent, "diagnostic");
    assert.equal(report.snapshot.loopCompleted, 0);
    assert.equal(report.comparison.grade, "exploratory");

    const opened = await readSnapshot(db, owner, report.snapshot.id, options);
    assert.equal(opened.error, undefined);
    const originalJson = opened.json;
    const originalHtml = opened.html;
    const originalSha = report.snapshot.jsonSha256;

    // AC-M0-12-3: revise creates successor; previous bytes unchanged
    const revisedAfter = windows(shared.before.samples, [
      sample({ queryId: "q1", queryVersion: "q1-v1", numerator: 1 }),
      sample({ queryId: "q2", queryVersion: "q2-v1", numerator: 1 }),
      sample({ queryId: "q3", queryVersion: "q3-v1", numerator: 1 }),
      sample({ queryId: "q4", queryVersion: "q4-v2", numerator: 1 }),
    ]).after;
    const revised = await reviseReport(db, owner, {
      action: "revise-report",
      brandId,
      operationId: randomUUID(),
      snapshotId: report.snapshot.id,
      before: shared.before,
      after: revisedAfter,
      locale: "zh-CN",
      metric: "recommendation_rate",
      brandName: "己品牌",
      note: "label correction",
    }, clock, options);
    assert.equal(revised.error, undefined);
    assert.equal(revised.snapshot.predecessorId, report.snapshot.id);
    assert.equal(revised.previous.status, "superseded");
    const previousFiles = await readSnapshot(db, owner, report.snapshot.id, options);
    assert.equal(previousFiles.json, originalJson);
    assert.equal(previousFiles.html, originalHtml);
    assert.equal(revised.previous.jsonSha256, originalSha);
    assert.equal(revised.previous.jsonBytes, "");
    assert.equal(revised.previous.htmlBytes, "");
    const nextFiles = await readSnapshot(db, owner, revised.snapshot.id, options);
    assert.notEqual(nextFiles.json, originalJson);

    // Ownership: outsider cannot read
    const denied = await readSnapshot(db, outsider, report.snapshot.id, options);
    assert.equal(denied.error, "NOT_FOUND");
    const listed = await listReports(db, outsider, brandId);
    assert.equal(listed.error, "NOT_FOUND");

    // D+7 reminder without auto charge
    const d7 = await requestRetest(db, owner, {
      action: "request-retest",
      brandId,
      operationId: randomUUID(),
      kind: "d7_reminder",
      intent: "business_loop",
      track: "model_api",
      timezone: "Asia/Shanghai",
      entityVersion: 1,
      before: shared.before,
      publicationId: randomUUID(),
      effectiveAt: "2026-11-18T07:00:00.000Z",
      locale: "zh-CN",
      metric: "recommendation_rate",
    }, clock);
    assert.equal(d7.error, undefined);
    assert.equal(d7.progressOnly, true);
    assert.equal(d7.todo.autoCharge, 0);
    assert.equal(d7.retest.status, "scheduled");

    // Purge removes report tables
    const purge = new PurgeDao(db);
    await purge.clearContents({ ownerId: owner, brandId }, time);
    const afterPurge = await listReports(db, owner, brandId);
    // brand still exists until full purge; clearContents deletes report rows
    assert.equal(afterPurge.error, undefined);
    assert.equal(afterPurge.snapshots.length, 0);
    assert.equal(afterPurge.retests.length, 0);
    assert.equal(afterPurge.todos.length, 0);
  });
}
