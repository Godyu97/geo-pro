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
  snapshotViews,
} from "../../src/features/reports/commands.ts";
import { compareWindows, computeD7DueAt, resolveLoopGate } from "../../src/features/reports/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";
import { correctRecommendation, saveComparisonFixture, saveLegacySnapshot } from "./saved-observations.mjs";
import { loadSnapshotComparisons, snapshotObservationsQuery } from "../../src/features/reports/snapshot-comparisons.ts";
import {
  generateSavedSnapshot,
  requestSavedComparison,
  requestSavedReminder,
  reviseSavedSnapshot,
  savedComparisonSchema,
} from "../../src/features/reports/saved-retest.ts";
import { windowObservationsQuery } from "../../src/features/reports/window-observations.ts";

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

test("saved comparison form rejects caller-supplied samples", () => {
  const parsed = savedComparisonSchema.safeParse({
    brandId: randomUUID(),
    operationId: randomUUID(),
    intent: "business_loop",
    track: "model_api",
    timezone: "Asia/Shanghai",
    beforeStart: "2026-11-01",
    beforeEnd: "2026-11-08",
    afterStart: "2026-11-09",
    afterEnd: "2026-11-16",
    locale: "zh-CN",
    samples: [{ observationId: randomUUID(), numerator: 50, denominator: 100 }],
  });
  assert.equal(parsed.success, false);
});

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
    const shared = await saveComparisonFixture(db, owner, brandId);
    const outsiderBrand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(outsider, outsiderBrand, time);
    const ownerVersion = await brands.version(owner, brandId);
    await brands.insertVersion(outsiderBrand, 1, ownerVersion.fields, time);
    const outsiderEvidence = await saveComparisonFixture(db, outsider, outsiderBrand);
    const foreignSample = outsiderEvidence.before.samples[0];
    const query = snapshotObservationsQuery(owner, brandId,
      [...shared.before.samples, ...shared.after.samples].map((item) => item.observationId));
    const started = performance.now();
    assert.equal((await queryWithParameters(db, query.sql, query.values)).length, 8);
    t.diagnostic(`eight-observation read: ${(performance.now() - started).toFixed(2)} ms`);
    const explain = kind === "sqlite" ? "EXPLAIN QUERY PLAN" : "EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF)";
    const plan = await queryWithParameters(db, `${explain} ${query.sql}`, query.values);
    const planText = plan.map((row) => row.detail ?? row["QUERY PLAN"]).join("\n");
    assert.match(planText, /answer_analysis_version_uidx|answer_analysis_brand_idx/);
    t.diagnostic(`bounded observation query: ${planText.split("\n").filter((line) => /answer_observation|answer_analysis|monitoring_slot|run_protocol_pin/.test(line)).join(" | ")}`);

    const windowQuery = windowObservationsQuery(
      owner, brandId, "model_api", "2026-10-31T16:00:00.000Z", "2026-11-07T16:00:00.000Z",
    );
    const windowPlan = await queryWithParameters(db, `${explain} ${windowQuery.sql}`, windowQuery.values);
    const windowPlanText = windowPlan.map((row) => row.detail ?? row["QUERY PLAN"]).join("\n");
    assert.match(windowPlanText, /answer_observation/);
    t.diagnostic(`window observation query: ${windowPlanText.split("\n").filter((line) => /answer_observation|Index|SCAN|Seq/.test(line)).join(" | ")}`);

    const saved = await requestSavedComparison(db, owner, {
      brandId,
      operationId: randomUUID(),
      intent: "business_loop",
      track: "model_api",
      timezone: "Asia/Shanghai",
      beforeStart: "2026-11-01",
      beforeEnd: "2026-11-08",
      afterStart: "2026-11-09",
      afterEnd: "2026-11-16",
      locale: "zh-CN",
    }, clock);
    assert.equal(saved.error, undefined);
    assert.equal(saved.downgraded, true);
    assert.equal(saved.loopCompleted, false);
    assert.equal(saved.retest.intent, "diagnostic");
    assert.equal(saved.retest.kind, "diagnostic");
    assert.equal(saved.comparison.commonQueryCount, 3);
    assert.equal(saved.comparison.grade, "exploratory");
    const savedReport = await generateSavedSnapshot(db, owner, {
      brandId,
      operationId: randomUUID(),
      retestId: saved.retest.id,
      locale: "zh-CN",
    }, clock, options);
    assert.equal(savedReport.error, undefined);
    assert.equal(savedReport.loopCompleted, false);
    assert.equal(savedReport.snapshot.loopCompleted, 0);
    assert.equal(savedReport.snapshot.intent, "diagnostic");
    const savedFiles = await readSnapshot(db, owner, savedReport.snapshot.id, options);
    const savedDocument = JSON.parse(savedFiles.json);
    assert.equal(savedDocument.loop_completed, false);
    assert.equal(savedDocument.comparisons.mention_rate.common_query_count, 3);
    assert.equal(savedDocument.comparisons.recommendation_rate.common_query_count, 3);
    assert.equal(savedDocument.comparisons.recommendation_rate.grade, "exploratory");
    assert.equal(savedDocument.comparisons.official_site_citation_rate.common_query_count, 1);
    assert.ok(savedDocument.comparisons.recommendation_rate.excluded_queries.some((item) => item.queryId === shared.questionIds[3] && item.reason === "modified"));
    const savedNumerators = savedDocument.comparisons.recommendation_rate.queries.flatMap((item) => [item.before.numerator, item.after.numerator]);
    assert.ok(savedNumerators.every((value) => value === 0 || value === 1));
    assert.equal(savedFiles.json.includes(foreignSample.observationId), false);
    const duplicateSnapshot = await generateSavedSnapshot(db, owner, {
      brandId, operationId: randomUUID(), retestId: saved.retest.id, locale: "zh-CN",
    }, clock, options);
    assert.equal(duplicateSnapshot.error, "CONFLICT");
    const emptyWindow = await requestSavedComparison(db, owner, {
      brandId, operationId: randomUUID(), intent: "diagnostic", track: "model_api", timezone: "Asia/Shanghai",
      beforeStart: "2020-01-01", beforeEnd: "2020-01-02", afterStart: "2020-01-03", afterEnd: "2020-01-04", locale: "zh-CN",
    }, clock);
    assert.equal(emptyWindow.error, "INVALID_INPUT");
    const missingLoop = await requestSavedReminder(db, owner, {
      brandId, operationId: randomUUID(), track: "model_api", timezone: "Asia/Shanghai", locale: "zh-CN",
    }, clock);
    assert.equal(missingLoop.error, "LOOP_NOT_READY");
    const unknownPublication = await requestSavedReminder(db, owner, {
      brandId, operationId: randomUUID(), track: "model_api", timezone: "Asia/Shanghai",
      publicationId: randomUUID(), locale: "zh-CN",
    }, clock);
    assert.equal(unknownPublication.error, "NOT_FOUND");
    const outsiderSaved = await requestSavedComparison(db, outsider, {
      brandId, operationId: randomUUID(), intent: "diagnostic", track: "model_api", timezone: "Asia/Shanghai",
      beforeStart: "2026-11-01", beforeEnd: "2026-11-08", afterStart: "2026-11-09", afterEnd: "2026-11-16", locale: "en",
    }, clock);
    assert.equal(outsiderSaved.error, "NOT_FOUND");

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
      before: {
        ...shared.before,
        samples: [...shared.before.samples, shared.before.samples[0], foreignSample],
      },
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
    const document = JSON.parse(originalJson);
    const [q1, q2, q3, q4] = shared.questionIds;
    assert.deepEqual(Object.keys(document.comparisons), ["mention_rate", "recommendation_rate", "official_site_citation_rate"]);
    assert.equal("metric" in document, false);
    const { mention_rate: mention, recommendation_rate: recommendation, official_site_citation_rate: citation } = document.comparisons;
    assert.equal(recommendation.common_query_count, 3);
    assert.equal(recommendation.frozen_query_count, 4);
    assert.equal(recommendation.before_sample_count, 3);
    assert.equal(recommendation.after_sample_count, 3);
    assert.equal(recommendation.before, 0);
    assert.equal(recommendation.after, 2 / 3);
    assert.equal(recommendation.delta_pp, (2 / 3) * 100);
    assert.equal(mention.delta_pp, (1 / 3 - 1) * 100);
    assert.equal(citation.common_query_count, 1);
    assert.equal(citation.before_sample_count, 1);
    assert.equal(citation.after_sample_count, 1);
    assert.equal(citation.before, null);
    assert.equal(citation.after, null);
    assert.equal(citation.delta_pp, null);
    assert.equal(citation.reason, "fewer_than_three_judgable_questions");
    assert.ok(recommendation.excluded_queries.some((item) => item.queryId === q4 && item.reason === "modified"));
    assert.deepEqual(citation.queries.map((item) => item.query_id), [q1]);
    assert.ok(citation.excluded_samples.after.some((item) => item.query_id === q2 && item.reason === "incomplete_citations"));
    assert.ok(citation.excluded_samples.after.some((item) => item.query_id === q3 && item.reason === "unknown_label"));
    assert.deepEqual(recommendation.excluded_samples.after, []);
    assert.equal(document.evidence[shared.before.samples[0].observationId].analysis_version, 1);
    assert.equal(document.evidence[shared.before.samples[0].observationId].scope.observed_region, "unknown");
    assert.equal(recommendation.unavailable_observation_count.before, 1);
    assert.equal(originalJson.includes(foreignSample.observationId), false);
    assert.equal(originalHtml.includes(foreignSample.observationId), false);
    assert.doesNotMatch(originalJson, /untrusted-|relative_increase/);
    assert.match(originalHtml, /<h2>提及率<\/h2>/);
    assert.match(originalHtml, /<h2>推荐率<\/h2>[\s\S]*?共同题 3\/4[\s\S]*?\+66\.7pp/);
    assert.match(originalHtml, /<h2>官网引用率<\/h2>[\s\S]*?共同题 1\/4[\s\S]*?N\/A/);
    t.diagnostic(`isolated snapshot ${report.snapshot.id}: common questions mention/recommendation/citation 3/3/1`);

    // AC-M0-12-3: revise creates successor; previous bytes unchanged
    const correctedId = shared.after.samples[1].observationId;
    await correctRecommendation(db, correctedId);
    const revised = await reviseReport(db, owner, {
      action: "revise-report",
      brandId,
      operationId: randomUUID(),
      snapshotId: report.snapshot.id,
      before: shared.before,
      after: shared.after,
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
    const next = JSON.parse(nextFiles.json);
    assert.equal(next.evidence[correctedId].analysis_version, 2);
    assert.equal(next.comparisons.recommendation_rate.delta_pp, 100);
    assert.equal(next.comparisons.official_site_citation_rate.delta_pp, null);

    const savedRevised = await reviseSavedSnapshot(db, owner, {
      brandId,
      operationId: randomUUID(),
      snapshotId: savedReport.snapshot.id,
      locale: "zh-CN",
    }, clock, options);
    assert.equal(savedRevised.error, undefined);
    assert.equal(savedRevised.snapshot.predecessorId, savedReport.snapshot.id);
    assert.equal(savedRevised.previous.status, "superseded");
    assert.equal(savedRevised.previous.jsonSha256, savedReport.snapshot.jsonSha256);
    const savedPrevious = await readSnapshot(db, owner, savedReport.snapshot.id, options);
    assert.equal(savedPrevious.json, savedFiles.json);
    assert.equal(savedPrevious.html, savedFiles.html);
    const savedNext = JSON.parse((await readSnapshot(db, owner, savedRevised.snapshot.id, options)).json);
    assert.equal(savedNext.predecessor_id, savedReport.snapshot.id);
    assert.equal(savedNext.comparisons.recommendation_rate.delta_pp, 100);
    assert.equal(savedNext.evidence[shared.after.samples[1].observationId].analysis_version, 2);
    const savedAgain = await reviseSavedSnapshot(db, owner, {
      brandId, operationId: randomUUID(), snapshotId: savedReport.snapshot.id, locale: "zh-CN",
    }, clock, options);
    assert.equal(savedAgain.error, "CONFLICT");

    const legacy = await saveLegacySnapshot(db, owner, brandId, retest.retest.id);
    const legacySuccessor = await reviseReport(db, owner, {
      action: "revise-report", brandId, operationId: randomUUID(), snapshotId: legacy.id,
      before: shared.before, after: shared.after, locale: "en", metric: "official_site_citation_rate",
    }, clock, options);
    assert.equal(legacySuccessor.snapshot.predecessorId, legacy.id);
    const legacyFiles = await readSnapshot(db, owner, legacy.id, options);
    assert.equal(legacyFiles.json, legacy.json);
    assert.equal(legacyFiles.html, legacy.html);
    const snapshotList = await snapshotViews(db, owner, [legacyFiles.snapshot, legacySuccessor.snapshot], options);
    assert.equal(snapshotList.get(legacy.id).metric, "recommendation_rate");
    assert.equal(snapshotList.get(legacy.id).comparisons, undefined);
    assert.equal(snapshotList.get(legacy.id).cost.cost.known[0].minor, 3);
    assert.equal(snapshotList.get(legacySuccessor.snapshot.id).comparisons.official_site_citation_rate.common_query_count, 1);
    const englishFiles = await readSnapshot(db, owner, legacySuccessor.snapshot.id, options);
    assert.match(englishFiles.html, /<h2>Mention rate<\/h2>/);
    assert.match(englishFiles.html, /<h2>Recommendation rate<\/h2>[\s\S]*?\+100\.0pp/);
    assert.match(englishFiles.html, /<h2>Official site citation rate<\/h2>[\s\S]*?N\/A/);

    await queryWithParameters(db, "DELETE FROM answer_analysis_version WHERE observation_id = ?", [correctedId]);
    const withoutAnalysis = await loadSnapshotComparisons(db, owner, brandId, shared, retest.retest);
    for (const { result, excludedSamples } of Object.values(withoutAnalysis.comparisons)) {
      assert.equal(result.deltaPp, null);
      assert.ok(excludedSamples.after.some((item) => item.observation_id === correctedId && item.reason === "missing_analysis"));
    }
    assert.equal(withoutAnalysis.comparisons.recommendation_rate.result.commonQueryCount, 2);
    assert.equal((await readSnapshot(db, owner, revised.snapshot.id, options)).json, nextFiles.json);

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
