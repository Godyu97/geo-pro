import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { reviseAnalysis, submitManualEvidence } from "../../src/features/evidence/commands.ts";
import {
  capabilityExpiryQuery,
  citationOwnershipQuery,
  EvidenceDao,
  overviewPlanLinkQuery,
  scopedObservationQuery,
} from "../../src/features/evidence/dao.ts";
import { analysisRuleVersion, fingerprintAnswer } from "../../src/features/evidence/rules.ts";
import {
  aggregateOverviewMetrics,
  capabilityIsExpired,
  filterSamplesByScope,
  latestCompleteCapture,
  ownedPageJudgement,
  questionMetricRows,
  summarizeCoverage,
  summarizeQuestionClusters,
} from "../../src/features/evidence/metrics.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import { invalidateEvidenceOverview, overviewCacheIdentity, readOverviewCache } from "../../src/features/evidence/overview-cache.ts";
import {
  overviewScopeForReturn,
  overviewScopeFromSearch,
  overviewScopePath,
} from "../../src/features/evidence/overview-contracts.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { memoryCache, openCache } from "../../src/lib/cache/store.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const time = "2026-11-20T08:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌", description: "Synthetic brand for overview", website: "https://yi.example.com",
  aliases: ["乙"], region: "CN", language: "zh-CN", competitors: [], questions: [],
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json", "utf8"));
  return journal.entries.at(-2).tag;
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Overview owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true]);
  return id;
}

function sample(partial) {
  return {
    observationId: randomUUID(),
    questionKey: "q1",
    questionText: "Q1",
    questionType: "discovery",
    sourceMode: "model_api",
    region: "CN",
    requestedNetworkMode: "unknown",
    capturedAt: time,
    evidenceState: "complete",
    citationSetState: "complete",
    mentioned: "true",
    recommended: "false",
    officialSiteCited: "false",
    ownedPageCited: "false",
    hasOfficialWebsite: true,
    ...partial,
  };
}

function answer(partial) {
  return {
    planSlotId: partial.planSlotId ?? null,
    evidenceState: "complete",
    citationSetState: "complete",
    requestedNetworkMode: "off",
    networkTrigger: "not_triggered",
    newSession: "unknown",
    searchRequired: false,
    newSessionRequired: false,
    ...partial,
  };
}

function planSlot(partial) {
  return {
    id: partial.id,
    at: partial.at,
    status: partial.status,
    sourceMode: "model_api",
    regions: [],
    networks: [],
    ...partial,
  };
}

test("cluster rates average fixed questions and leave unknown or conflicting questions visible", () => {
  const first = { id: "a", audience: "Buyers", intent: "Compare" };
  const second = { id: "b", audience: "Operators", intent: "Maintain" };
  const affixed = [
    [sample({ questionKey: "q1", recommended: "true" }), first],
    [sample({ questionKey: "q1", recommended: "false" }), first],
    [sample({ questionKey: "q2", recommended: "true" }), first],
    [sample({ questionKey: "q2", recommended: "true" }), first],
    [sample({ questionKey: "q2", recommended: "true" }), first],
    [sample({ questionKey: "q3", recommended: "unknown", citationSetState: "partial" }), first],
    [sample({ questionKey: "q4", recommended: "false" }), first],
    [sample({ questionKey: "q4", recommended: "false" }), second],
    [sample({ questionKey: "q5", recommended: "false" }), second],
  ];
  const { metrics } = aggregateOverviewMetrics(affixed.map(([item]) => item));
  const groups = summarizeQuestionClusters(metrics, new Map(affixed.map(([item, cluster]) => [item.observationId, cluster])));
  assert.equal(metrics.recommended.equalWeight, 0.375);
  assert.deepEqual(groups.map(({ questionKeys }) => questionKeys), [["q1", "q2", "q3"], ["q5"], ["q4"]]);
  assert.deepEqual(groups[0].metrics.recommended, { equalWeight: 0.75, coveredQuestions: 2 });
  assert.equal(groups[0].metrics.officialSiteCited.coveredQuestions, 2);
  assert.equal(questionMetricRows(metrics).find((row) => row.questionKey === "q3").cells.recommended.rate, null);
});

test("AC-M0-07-1 empty scope shows N/A without fabricated rates", () => {
  const metrics = aggregateOverviewMetrics([]);
  assert.equal(metrics.viewStatus, "empty");
  assert.equal(metrics.metrics.recommended.status, "na");
  assert.equal(metrics.metrics.recommended.equalWeight, null);
  assert.equal(metrics.metrics.recommended.pooled.rate, null);
});

test("AC-M0-07-2 equal-weight 75% and pooled 80% with five samples", () => {
  const samples = [
    sample({ questionKey: "q1", questionText: "题1", recommended: "true" }),
    sample({ questionKey: "q1", questionText: "题1", recommended: "false" }),
    sample({ questionKey: "q2", questionText: "题2", recommended: "true" }),
    sample({ questionKey: "q2", questionText: "题2", recommended: "true" }),
    sample({ questionKey: "q2", questionText: "题2", recommended: "true" }),
  ];
  const metrics = aggregateOverviewMetrics(samples);
  assert.equal(metrics.sampleIds.length, 5);
  assert.ok(Math.abs((metrics.metrics.recommended.equalWeight ?? 0) - 0.75) < 1e-9);
  assert.equal(metrics.metrics.recommended.pooled.numerator, 4);
  assert.equal(metrics.metrics.recommended.pooled.denominator, 5);
  assert.ok(Math.abs((metrics.metrics.recommended.pooled.rate ?? 0) - 0.8) < 1e-9);
});

test("per-question rows keep four different fractions and a zero-denominator N/A cell", () => {
  const samples = [
    sample({
      questionKey: "q1", questionText: "购买怎么选",
      mentioned: "true", recommended: "true", officialSiteCited: "unknown", ownedPageCited: "true",
    }),
    sample({
      questionKey: "q1", questionText: "购买怎么选",
      mentioned: "true", recommended: "false", officialSiteCited: "unknown", ownedPageCited: "unknown",
    }),
    sample({
      questionKey: "q2", questionText: "售后怎么保",
      mentioned: "true", recommended: "true", officialSiteCited: "true", ownedPageCited: "false",
    }),
    sample({
      questionKey: "q2", questionText: "售后怎么保",
      mentioned: "false", recommended: "true", officialSiteCited: "true", ownedPageCited: "false",
    }),
    sample({
      questionKey: "q2", questionText: "售后怎么保",
      mentioned: "false", recommended: "true", officialSiteCited: "false", ownedPageCited: "false",
    }),
    sample({
      questionKey: "q3", questionText: "安装是否复杂",
      mentioned: "true", recommended: "unknown", officialSiteCited: "false", ownedPageCited: "false",
    }),
  ];
  const metrics = aggregateOverviewMetrics(samples);
  assert.ok(Math.abs((metrics.metrics.recommended.equalWeight ?? 0) - 0.75) < 1e-9);
  assert.equal(metrics.metrics.recommended.pooled.numerator, 4);
  assert.equal(metrics.metrics.recommended.pooled.denominator, 5);
  assert.equal(metrics.metrics.recommended.coveredQuestions, 2);
  assert.equal(metrics.metrics.recommended.fixedQuestions, 3);

  const rows = questionMetricRows(metrics.metrics);
  const byText = new Map(rows.map((row) => [row.questionText, row]));
  assert.equal(rows.length, 3);

  const first = byText.get("购买怎么选");
  assert.deepEqual(first.cells.mentioned, { numerator: 2, denominator: 2, rate: 1, unknown: 0 });
  assert.deepEqual(first.cells.recommended, { numerator: 1, denominator: 2, rate: 0.5, unknown: 0 });
  assert.deepEqual(first.cells.officialSiteCited, { numerator: 0, denominator: 0, rate: null, unknown: 2 });
  assert.deepEqual(first.cells.ownedPageCited, { numerator: 1, denominator: 1, rate: 1, unknown: 1 });

  const second = byText.get("售后怎么保");
  assert.deepEqual(second.cells.mentioned, { numerator: 1, denominator: 3, rate: 1 / 3, unknown: 0 });
  assert.deepEqual(second.cells.recommended, { numerator: 3, denominator: 3, rate: 1, unknown: 0 });
  assert.deepEqual(second.cells.officialSiteCited, { numerator: 2, denominator: 3, rate: 2 / 3, unknown: 0 });
  assert.deepEqual(second.cells.ownedPageCited, { numerator: 0, denominator: 3, rate: 0, unknown: 0 });

  const unknownRecommendation = byText.get("安装是否复杂");
  assert.deepEqual(unknownRecommendation.cells.recommended, { numerator: 0, denominator: 0, rate: null, unknown: 1 });
  assert.deepEqual(unknownRecommendation.cells.mentioned, { numerator: 1, denominator: 1, rate: 1, unknown: 0 });
  assert.notEqual(unknownRecommendation.cells.recommended.denominator, 1);
});

test("missing official-site rows stay N/A and are not shown as zero", () => {
  const metrics = aggregateOverviewMetrics([
    sample({ hasOfficialWebsite: false, questionKey: "q1", questionText: "题1", recommended: "true", officialSiteCited: "false" }),
  ]);
  assert.equal(metrics.metrics.officialSiteCited.reason, "official-website-not-applicable");
  assert.equal(metrics.metrics.officialSiteCited.equalWeight, null);
  const [row] = questionMetricRows(metrics.metrics);
  assert.equal(row.questionText, "题1");
  assert.deepEqual(row.cells.officialSiteCited, { numerator: 0, denominator: 0, rate: null, unknown: 0 });
  assert.equal(row.cells.recommended.denominator, 1);
});

test("answer-list filters do not enter the overview scope used by the per-question table", () => {
  const parsed = overviewScopeFromSearch({
    brandId: "11111111-1111-4111-8111-111111111111",
    sourceMode: "model_api",
    region: "CN",
    q: "购买怎么选",
    recommended: "unknown",
    mentioned: "false",
    cluster: "cluster-1",
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.region, "CN");
  assert.equal(parsed.data.q, undefined);
  assert.equal(parsed.data.recommended, undefined);
  assert.equal(parsed.data.mentioned, undefined);
  assert.equal(parsed.data.cluster, undefined);
});

test("qualified answer without plan slots keeps rates and marks coverage N/A", () => {
  const metrics = aggregateOverviewMetrics([sample({ mentioned: "true", recommended: "true" })]);
  const coverage = summarizeCoverage({
    slots: [],
    answers: [],
    scope: { sourceMode: "model_api" },
    now: time,
  });
  assert.equal(metrics.metrics.mentioned.status, "ready");
  assert.equal(metrics.metrics.recommended.status, "ready");
  assert.equal(coverage.status, "na");
  assert.equal(coverage.reason, "no-frozen-plan-slots");
  assert.equal(coverage.planned, 0);
  assert.equal(coverage.eligibleRate, null);
});

test("due window keeps failed and pending slots in P", () => {
  const failed = "slot-failed";
  const pending = "slot-pending";
  const first = "slot-ok-1";
  const second = "slot-ok-2";
  const future = "slot-future";
  const coverage = summarizeCoverage({
    now: "2026-11-24T00:00:00.000Z",
    scope: { sourceMode: "model_api", from: "2026-11-20T00:00:00.000Z", to: "2026-11-30T00:00:00.000Z" },
    slots: [
      planSlot({ id: failed, at: "2026-11-20T01:00:00.000Z", status: "failed" }),
      planSlot({ id: pending, at: "2026-11-20T02:00:00.000Z", status: "completed" }),
      planSlot({ id: first, at: "2026-11-20T03:00:00.000Z", status: "completed" }),
      planSlot({ id: second, at: "2026-11-20T04:00:00.000Z", status: "completed" }),
      planSlot({ id: future, at: "2026-11-25T00:00:00.000Z", status: "scheduled" }),
      planSlot({ id: "paused", at: "2026-11-20T05:00:00.000Z", status: "paused" }),
    ],
    answers: [
      answer({ planSlotId: pending, requestedNetworkMode: "on", networkTrigger: "unknown" }),
      answer({ planSlotId: first }),
      answer({ planSlotId: second }),
    ],
  });
  assert.equal(coverage.planned, 5);
  assert.equal(coverage.failed, 1);
  assert.equal(coverage.pending, 1);
  assert.equal(coverage.paused, 1);
  assert.equal(coverage.eligible, 2);
  assert.equal(coverage.networkUnknown, 1);
  assert.equal(coverage.eligibleRate, 2 / 5);
  assert.notEqual(coverage.eligibleRate, 1);
});

test("owned page citation stays apart from official site and unknown ownership", () => {
  assert.equal(ownedPageJudgement("complete", ["owned_account", "unknown"]), "true");
  assert.equal(ownedPageJudgement("complete", ["unknown"]), "unknown");
  assert.equal(ownedPageJudgement("complete", []), "false");
  const metrics = aggregateOverviewMetrics([
    sample({
      officialSiteCited: "false",
      ownedPageCited: ownedPageJudgement("complete", ["owned_account", "unknown"]),
    }),
  ]);
  assert.equal(metrics.metrics.officialSiteCited.equalWeight, 0);
  assert.equal(metrics.metrics.ownedPageCited.equalWeight, 1);
  assert.equal(metrics.metrics.officialSiteCited.pooled.denominator, 1);
  const unknownOnly = aggregateOverviewMetrics([
    sample({ ownedPageCited: ownedPageJudgement("complete", ["unknown"]), citationSetState: "complete" }),
  ]);
  assert.equal(unknownOnly.metrics.ownedPageCited.status, "na");
  assert.equal(unknownOnly.metrics.ownedPageCited.reason, "no-judgable-owned-citations");
  assert.equal(unknownOnly.metrics.ownedPageCited.pooled.denominator, 0);
  assert.equal(unknownOnly.metrics.ownedPageCited.equalWeight, null);
});

test("latest complete capture stays visible when the capability record is expired", () => {
  const capturedAt = "2026-11-22T03:00:00.000Z";
  assert.equal(latestCompleteCapture([
    { capturedAt: "2026-11-21T00:00:00.000Z", evidenceState: "incomplete" },
    { capturedAt, evidenceState: "complete" },
    { capturedAt: "2026-11-23T00:00:00.000Z", evidenceState: "contested" },
  ]), capturedAt);
  assert.equal(latestCompleteCapture([{ capturedAt, evidenceState: "contested" }]), null);
  assert.equal(capabilityIsExpired(["2026-11-01T00:00:00.000Z"], "2026-11-24T00:00:00.000Z"), true);
  assert.equal(capabilityIsExpired([null, "2026-12-01T00:00:00.000Z"], "2026-11-24T00:00:00.000Z"), false);
});

test("track filter excludes the other sourceMode", () => {
  const samples = [
    sample({ sourceMode: "model_api", recommended: "true" }),
    sample({ sourceMode: "consumer_ui", recommended: "true", observationId: randomUUID() }),
  ];
  const filtered = filterSamplesByScope(samples, { sourceMode: "consumer_ui" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].sourceMode, "consumer_ui");
  const metrics = aggregateOverviewMetrics(filtered);
  assert.equal(metrics.sampleCount, 1);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: overview command ownership, empty N/A, dual-track isolation`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });

    const [owner, outsider] = await Promise.all([account(db), account(db)]);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);

    const empty = await readEvidenceOverview(db, owner, {
      brandId: brand,
      sourceMode: "model_api",
    });
    assert.equal("error" in empty, false);
    assert.equal(empty.viewStatus, "empty");
    assert.equal(empty.metrics.recommended.status, "na");
    assert.equal(empty.demo, false);
    assert.equal(empty.suggestions.length, 0);

    const denied = await readEvidenceOverview(db, outsider, {
      brandId: brand,
      sourceMode: "model_api",
    });
    assert.equal(denied.error, "NOT_FOUND");

    const first = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "这个品类里该怎么选？",
      answerText: "可以考虑乙品牌。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://overview/1",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "true",
      recommended: "true",
      officialSiteCited: "false",
    }, clock);
    assert.equal(first.error, undefined);

    const consumer = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "日常使用要注意什么？",
      answerText: "乙品牌值得考虑。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://overview/2",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "true",
      recommended: "true",
      officialSiteCited: "false",
    }, clock);
    assert.equal(consumer.error, undefined);

    // Manual evidence defaults to consumer_ui in submitManualEvidence — verify command path.
    const apiView = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "model_api" });
    const consumerView = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "consumer_ui" });
    assert.equal("error" in apiView, false);
    assert.equal("error" in consumerView, false);
    // All manual submits use consumer_ui per evidence rules.
    assert.equal(apiView.sampleCount, 0);
    assert.ok(consumerView.sampleCount >= 1);
    assert.ok(consumerView.answers.every((item) => item.sourceMode === "consumer_ui"));
  });
}

test("scope query keeps track, region, network and time and drops blanks", () => {
  const brandId = randomUUID();
  const parsed = overviewScopeFromSearch({
    brandId,
    sourceMode: "consumer_ui",
    region: "cn",
    requestedNetworkMode: "",
    from: "2026-11-20T08:00:00.000Z",
    to: " ",
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.region, "CN");
  assert.equal(parsed.data.requestedNetworkMode, undefined);
  assert.equal(parsed.data.to, undefined);
  const href = overviewScopePath("/dashboard/monitoring/answers", parsed.data);
  const url = new URL(href, "http://localhost");
  assert.equal(url.searchParams.get("brandId"), brandId);
  assert.equal(url.searchParams.get("sourceMode"), "consumer_ui");
  assert.equal(url.searchParams.get("region"), "CN");
  assert.equal(url.searchParams.get("from"), "2026-11-20T08:00:00.000Z");
  assert.equal(url.searchParams.has("requestedNetworkMode"), false);
  assert.equal(url.searchParams.has("to"), false);
  const roundTrip = overviewScopeFromSearch(Object.fromEntries(url.searchParams.entries()));
  assert.equal(roundTrip.success, true);
  assert.equal(roundTrip.data.region, "CN");
  assert.equal(roundTrip.data.from, "2026-11-20T08:00:00.000Z");
});

test("unknown region and network stay out of a positive filter unless that value is selected", () => {
  const samples = [
    sample({ region: "CN", requestedNetworkMode: "on" }),
    sample({ region: "unknown", requestedNetworkMode: "unknown" }),
    sample({ region: "US", requestedNetworkMode: "off" }),
  ];
  assert.deepEqual(
    filterSamplesByScope(samples, { requestedNetworkMode: "on" }).map((item) => item.requestedNetworkMode),
    ["on"],
  );
  assert.equal(filterSamplesByScope(samples, { requestedNetworkMode: "unknown" }).length, 1);
  assert.deepEqual(filterSamplesByScope(samples, { region: "CN" }).map((item) => item.region), ["CN"]);
  assert.equal(filterSamplesByScope(samples, { region: "unknown" })[0].region, "unknown");
  assert.equal(filterSamplesByScope(samples, {}).length, 3);
  const early = sample({ capturedAt: "2026-11-20T08:00:00.000Z" });
  const late = sample({ capturedAt: "2026-11-21T08:00:00.000Z" });
  const windowed = filterSamplesByScope([early, late], {
    from: "2026-11-20T00:00:00.000Z",
    to: "2026-11-20T23:59:59.999Z",
  });
  assert.deepEqual(windowed.map((item) => item.observationId), [early.observationId]);
});

test("official channel scope survives parsing and return links", () => {
  const brandId = randomUUID();
  const channel = `${randomUUID()}@2`;
  const parsed = overviewScopeFromSearch({ brandId, sourceMode: "model_api", channel });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.channel, channel);
  const returned = overviewScopeForReturn({ brandId, channel, from: "invalid" }, { brandId, sourceMode: "model_api" });
  assert.equal(new URL(overviewScopePath("/answers", returned), "http://localhost").searchParams.get("channel"), channel);
  assert.equal(overviewScopeFromSearch({ brandId, channel: "not-a-version" }).success, false);
  assert.equal(overviewScopeFromSearch({ brandId, sourceMode: "consumer_ui", channel }).data.channel, undefined);
});

test("return links keep a valid region when the time window cannot be parsed", () => {
  const brandId = randomUUID();
  const scope = overviewScopeForReturn({
    brandId,
    sourceMode: "model_api",
    region: "CN",
    requestedNetworkMode: "off",
    from: "yesterday",
  }, { brandId, sourceMode: "consumer_ui" });
  assert.equal(scope.sourceMode, "model_api");
  assert.equal(scope.region, "CN");
  assert.equal(scope.requestedNetworkMode, "off");
  assert.equal(scope.from, undefined);
  const otherBrand = randomUUID();
  const kept = overviewScopeForReturn({
    brandId: otherBrand,
    sourceMode: "consumer_ui",
    region: "US",
  }, { brandId, sourceMode: "model_api" });
  assert.equal(kept.brandId, brandId);
  assert.equal(kept.region, "US");
  assert.equal(kept.sourceMode, "consumer_ui");
});

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function insertScopedObservation(db, row) {
  await queryWithParameters(db, `INSERT INTO answer_observation (
    id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
    fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
    evidence_state, locator_ref, collector_id, missing_reason, created_at,
    target_region, observed_region, new_session, product_mode, network_trigger
  ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'zh-CN', ?, 1, 'complete', 'complete', NULL, NULL, NULL, ?, ?, ?, 'unknown', 'unknown', 'unknown')`, [
    row.id, row.brandId, row.ownerId, row.sourceMode, row.captureMethod, row.questionText, "样本回答",
    sha(row.id), row.capturedAt, row.targetRegion, row.requestedNetworkMode, row.capturedAt,
    row.targetRegion, row.observedRegion,
  ]);
  await queryWithParameters(db, `INSERT INTO answer_analysis_version (
    id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
    official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
  ) VALUES (?, ?, ?, 1, 1, 's-m0-06-v1', 'true', ?, 'false', NULL, 'classified', NULL, NULL, NULL, ?)`, [
    randomUUID(), row.id, row.brandId, row.recommended, row.capturedAt,
  ]);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: overview scope keeps one track, target region, requested network and time window`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const [owner, outsider] = await Promise.all([account(db), account(db)]);
    const brand = randomUUID();
    const otherBrand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);
    await brands.insertBrand(outsider, otherBrand, time);
    await brands.insertVersion(otherBrand, 1, fields, time);

    const ids = {
      targetCnObservedUs: randomUUID(),
      targetUsObservedCn: randomUUID(),
      networkOn: randomUUID(),
      networkUnknown: randomUUID(),
      laterDay: randomUUID(),
      consumer: randomUUID(),
      otherBrand: randomUUID(),
      otherOwner: randomUUID(),
    };
    const day = "2026-11-20T08:00:00.000Z";
    const nextDay = "2026-11-21T08:00:00.000Z";
    const rows = [
      ["targetCnObservedUs", "model_api", "official_api", "CN", "US", "off", day, "true", owner, brand],
      ["targetUsObservedCn", "model_api", "official_api", "US", "CN", "off", day, "true", owner, brand],
      ["networkOn", "model_api", "official_api", "CN", "CN", "on", day, "false", owner, brand],
      ["networkUnknown", "model_api", "official_api", "CN", "CN", "unknown", day, "true", owner, brand],
      ["laterDay", "model_api", "official_api", "CN", "CN", "off", nextDay, "true", owner, brand],
      ["consumer", "consumer_ui", "manual", "CN", "CN", "off", day, "true", owner, brand],
      ["otherBrand", "model_api", "official_api", "CN", "CN", "off", day, "true", outsider, otherBrand],
      ["otherOwner", "model_api", "official_api", "CN", "CN", "off", day, "true", outsider, brand],
    ];
    for (const [key, sourceMode, captureMethod, targetRegion, observedRegion, requestedNetworkMode, capturedAt, recommended, ownerId, brandId] of rows) {
      await insertScopedObservation(db, {
        id: ids[key], brandId, ownerId, sourceMode, captureMethod, questionText: key,
        targetRegion, observedRegion, requestedNetworkMode, capturedAt, recommended,
      });
    }

    const answerIds = (view) => new Set(view.answers.map((item) => item.observationId));
    const consumerView = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "consumer_ui" });
    assert.equal(consumerView.error, undefined);
    assert.deepEqual(answerIds(consumerView), new Set([ids.consumer]));
    assert.equal(consumerView.sampleCount, 1);
    const consumerHref = new URL(consumerView.nextActions.find((item) => item.kind === "view_answers").href, "http://localhost");
    assert.equal(consumerHref.searchParams.get("sourceMode"), "consumer_ui");
    assert.equal(consumerHref.searchParams.get("brandId"), brand);

    const china = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "model_api", region: "CN" });
    assert.deepEqual(answerIds(china), new Set([ids.targetCnObservedUs, ids.networkOn, ids.networkUnknown, ids.laterDay]));
    assert.equal(answerIds(china).has(ids.targetUsObservedCn), false);

    const offline = await readEvidenceOverview(db, owner, {
      brandId: brand, sourceMode: "model_api", region: "CN", requestedNetworkMode: "off",
    });
    assert.deepEqual(answerIds(offline), new Set([ids.targetCnObservedUs, ids.laterDay]));

    const windowed = await readEvidenceOverview(db, owner, {
      brandId: brand,
      sourceMode: "model_api",
      region: "CN",
      requestedNetworkMode: "off",
      from: "2026-11-20T00:00:00.000Z",
      to: "2026-11-20T23:59:59.999Z",
    });
    assert.deepEqual(answerIds(windowed), new Set([ids.targetCnObservedUs]));
    assert.equal(windowed.metrics.recommended.equalWeight, 1);
    assert.equal(windowed.coverage.status, "na");
    assert.equal(windowed.coverage.reason, "no-frozen-plan-slots");
    assert.equal(windowed.coverage.planned, 0);
    assert.equal(windowed.collection.lastCapturedAt, "2026-11-20T08:00:00.000Z");
    assert.equal(windowed.collection.capabilityExpired, false);
    const windowHref = new URL(windowed.nextActions.find((item) => item.kind === "view_answers").href, "http://localhost");
    assert.equal(windowHref.searchParams.get("region"), "CN");
    assert.equal(windowHref.searchParams.get("requestedNetworkMode"), "off");
    assert.equal(windowHref.searchParams.get("from"), "2026-11-20T00:00:00.000Z");
    assert.equal(windowHref.searchParams.get("to"), "2026-11-20T23:59:59.999Z");

    const online = await readEvidenceOverview(db, owner, {
      brandId: brand, sourceMode: "model_api", requestedNetworkMode: "on",
    });
    assert.deepEqual(answerIds(online), new Set([ids.networkOn]));
    assert.equal(answerIds(online).has(ids.networkUnknown), false);
    assert.equal(online.metrics.recommended.equalWeight, 0);

    const unknownRegion = await readEvidenceOverview(db, owner, {
      brandId: brand, sourceMode: "model_api", region: "unknown",
    });
    assert.equal(unknownRegion.sampleCount, 0);
    assert.equal(unknownRegion.answers.length, 0);

    const scoped = scopedObservationQuery({
      ownerId: owner,
      brandId: brand,
      sourceMode: "model_api",
      region: "CN",
      requestedNetworkMode: "off",
      from: "2026-11-20T00:00:00.000Z",
      to: "2026-11-20T23:59:59.999Z",
    });
    assert.match(scoped.sql, /o\.target_region = \?/);
    assert.doesNotMatch(scoped.sql, /observed_region = \?/);
    assert.doesNotMatch(scoped.sql, /network_trigger = \?/);
    const explainPrefix = kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
    const plan = await queryWithParameters(db, `${explainPrefix}${scoped.sql}`, scoped.values);
    console.log(`${kind} target-region scope ${scoped.values.length} params`);
    console.log(plan.map((row) => JSON.stringify(row)).join("\n"));
    assert.ok(JSON.stringify(plan).length > 20);
  });

  test(`${kind}: coverage uses due plan slots, owned pages, and the latest capture`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const owner = await account(db);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);
    const channelId = randomUUID();
    const planId = randomUUID();
    const draftId = randomUUID();
    const now = "2026-11-24T12:00:00.000Z";
    const day = "2026-11-20T08:00:00.000Z";
    await queryWithParameters(db, `INSERT INTO capability_channel (id, vendor_id, kind, created_at) VALUES (?, 'vendor', 'model_api', ?)`, [channelId, day]);
    await queryWithParameters(db, `INSERT INTO capability_version (
      channel_id, version, operation_id, fingerprint, actor_id, reason, status, display_name, product_entry, mode,
      model_version, availability, search_required, citation_capability, region_target, region_actual, limits_summary,
      sop_summary, verified_at, expires_at, public_visible, changed_at
    ) VALUES (?, 1, ?, ?, ?, 'verification', 'verified', 'API', 'entry', 'mode', 'model', 'up', 0, 'complete', 'CN', 'CN', 'limits', 'sop', ?, ?, 1, ?)`,
    [channelId, randomUUID(), "c".repeat(64), owner, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", day]);
    await queryWithParameters(db, `INSERT INTO sampling_plan (
      id, version, brand_id, owner_id, phase, currency, budget_minor, spent_minor, pending_minor, created_at
    ) VALUES (?, 1, ?, ?, 'active', 'CNY', 100, 0, 0, ?), (?, 1, ?, ?, 'draft', 'CNY', 100, 0, 0, ?)`,
    [planId, brand, owner, day, draftId, brand, owner, day]);

    const failed = randomUUID();
    const pending = randomUUID();
    const owned = randomUUID();
    const empty = randomUUID();
    const future = randomUUID();
    const draftSlot = randomUUID();
    const slotRows = [
      [failed, planId, "2026-11-20T01:00:00.000Z", "failed"],
      [pending, planId, "2026-11-20T02:00:00.000Z", "completed"],
      [owned, planId, "2026-11-20T03:00:00.000Z", "completed"],
      [empty, planId, "2026-11-20T04:00:00.000Z", "completed"],
      [future, planId, "2026-11-25T01:00:00.000Z", "scheduled"],
      [draftSlot, draftId, "2026-11-20T01:00:00.000Z", "failed"],
    ];
    await queryWithParameters(db, `INSERT INTO sampling_slot (
      id, plan_id, brand_id, owner_id, channel_id, at, status, manual, cost_minor
    ) VALUES ${slotRows.map(() => "(?, ?, ?, ?, ?, ?, ?, 0, 1)").join(", ")}`,
    slotRows.flatMap(([id, plan, at, status]) => [id, plan, brand, owner, channelId, at, status]));

    const evidence = new EvidenceDao(db);
    async function linkedAnswer(planSlotId, partial) {
      const runId = randomUUID();
      const monitorId = randomUUID();
      await queryWithParameters(db, `INSERT INTO monitoring_run (
        id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
        repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
        requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
        status, sampling_complete, created_at
      ) VALUES (?, ?, ?, ?, ?, 'model_api', ?, 1, 1, 1, 1, 1, 1, 'CN', 'zh-CN', ?, 'CNY', 10, 10, 0, 'queued', 0, ?)`,
      [runId, brand, owner, randomUUID(), "d".repeat(64), randomUUID(), partial.requestedNetworkMode, day]);
      await queryWithParameters(db, `INSERT INTO monitoring_slot (
        id, run_id, brand_id, question_id, natural_question, channel_id, channel_version, repeat_index,
        reservation_id, status, created_at, adopted_attempt_id, late
      ) VALUES (?, ?, ?, ?, 1, ?, ?, 1, NULL, 'failed', ?, NULL, 0)`,
      [monitorId, runId, brand, partial.questionId ?? randomUUID(), channelId, partial.version ?? 1, day]);
      await queryWithParameters(db, `INSERT INTO sampling_due_run (
        id, plan_id, plan_version, brand_id, owner_id, channel_id, window_id, slot_id, timezone,
        kind, status, monitoring_run_id, charged_minor, prompt_ids_json, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, '2026-11-20', ?, 'Asia/Shanghai', 'official', 'accepted', ?, 0, NULL, ?)`,
      [randomUUID(), planId, brand, owner, channelId, planSlotId, runId, day]);
      if (partial.failed) return null;
      const attemptId = randomUUID();
      await queryWithParameters(db, `INSERT INTO monitoring_attempt (
        id, slot_id, run_id, brand_id, kind, ordinal, transport, synthetic, disposition, raw_text,
        cost_state, created_at
      ) VALUES (?, ?, ?, ?, 'sampling', 1, 'official_api', 0, 'adopted', '合成测试回答', 'none', ?)`,
      [attemptId, monitorId, runId, brand, day]);
      await queryWithParameters(db, `UPDATE monitoring_slot
        SET status = 'succeeded', adopted_attempt_id = ? WHERE id = ?`, [attemptId, monitorId]);
      const observationId = randomUUID();
      await evidence.insertObservation({
        id: observationId,
        brandId: brand,
        ownerId: owner,
        slotId: monitorId,
        attemptId,
        sourceMode: "model_api",
        captureMethod: "official_api",
        questionText: partial.questionText,
        answerText: "隔离回答，只用于覆盖验收。",
        fingerprint: fingerprintAnswer(partial.questionText, "隔离回答，只用于覆盖验收。"),
        capturedAt: partial.capturedAt,
        region: "CN",
        language: "zh-CN",
        requestedNetworkMode: partial.requestedNetworkMode,
        targetRegion: "CN",
        observedRegion: "unknown",
        newSession: "unknown",
        productMode: "unknown",
        networkTrigger: partial.networkTrigger,
        entityVersion: 1,
        citationSetState: partial.citationSetState ?? "complete",
        evidenceState: "complete",
        locatorRef: null,
        collectorId: null,
        missingReason: null,
        createdAt: partial.capturedAt,
      });
      await evidence.insertAnalysis({
        id: randomUUID(),
        observationId,
        brandId: brand,
        version: 1,
        entityVersion: 1,
        ruleVersion: analysisRuleVersion,
        mentioned: partial.mentioned ?? "true",
        recommended: partial.recommended ?? "true",
        officialSiteCited: "false",
        evidenceSpan: null,
        status: "classified",
        revisedFrom: null,
        reason: null,
        reviewerId: null,
        createdAt: partial.capturedAt,
      });
      if (partial.citations) await evidence.insertCitations(partial.citations.map((ownership) => ({
        id: randomUUID(),
        observationId,
        brandId: brand,
        rawUrl: "https://owned.example.com/page",
        normalizedUrl: "https://owned.example.com/page",
        citationOrigin: "provider_native",
        positionLabel: null,
        ownership,
        pageStatus: "unknown",
        createdAt: partial.capturedAt,
      })));
      return observationId;
    }

    await linkedAnswer(pending, {
      questionText: "待核对的问题",
      capturedAt: "2026-11-20T02:00:00.000Z",
      requestedNetworkMode: "on",
      networkTrigger: "unknown",
      citations: ["unknown"],
    });
    await linkedAnswer(owned, {
      questionText: "自有页问题",
      capturedAt: "2026-11-20T03:30:00.000Z",
      requestedNetworkMode: "off",
      networkTrigger: "not_triggered",
      citations: ["owned_account", "unknown"],
    });
    await linkedAnswer(empty, {
      questionText: "空引用问题",
      capturedAt: "2026-11-20T04:30:00.000Z",
      requestedNetworkMode: "off",
      networkTrigger: "not_triggered",
    });

    const view = await readEvidenceOverview(db, owner, {
      brandId: brand,
      sourceMode: "model_api",
      from: "2026-11-20T00:00:00.000Z",
      to: "2026-11-30T00:00:00.000Z",
    }, undefined, () => now);
    assert.equal(view.error, undefined);
    assert.equal(view.coverage.planned, 4);
    assert.equal(view.coverage.failed, 1);
    assert.equal(view.coverage.pending, 1);
    assert.equal(view.coverage.eligible, 2);
    assert.equal(view.coverage.networkUnknown, 1);
    assert.equal(view.coverage.eligibleRate, 0.5);
    assert.notEqual(view.coverage.eligibleRate, 1);
    assert.equal(view.metrics.mentioned.status, "ready");
    assert.equal(view.metrics.officialSiteCited.equalWeight, 0);
    assert.equal(view.metrics.ownedPageCited.pooled.denominator, 2);
    assert.equal(view.metrics.ownedPageCited.pooled.numerator, 1);
    assert.notEqual(view.metrics.ownedPageCited.equalWeight, view.metrics.officialSiteCited.equalWeight);
    assert.equal(view.collection.lastCapturedAt, "2026-11-20T04:30:00.000Z");
    assert.equal(view.collection.capabilityExpired, true);

    const explainPrefix = kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
    const linkQuery = overviewPlanLinkQuery(owner, brand);
    const citeQuery = citationOwnershipQuery(brand, [randomUUID()]);
    const expiryQuery = capabilityExpiryQuery([channelId]);
    const linkPlan = JSON.stringify(await queryWithParameters(db, `${explainPrefix}${linkQuery.sql}`, linkQuery.values));
    const citePlan = JSON.stringify(await queryWithParameters(db, `${explainPrefix}${citeQuery.sql}`, citeQuery.values));
    const expiryPlan = JSON.stringify(await queryWithParameters(db, `${explainPrefix}${expiryQuery.sql}`, expiryQuery.values));
    console.log(`${kind} coverage link plan ${linkPlan}`);
    console.log(`${kind} coverage citation plan ${citePlan}`);
    console.log(`${kind} coverage expiry plan ${expiryPlan}`);
    assert.match(linkPlan, /sampling_due_run/);
    assert.match(citePlan, /answer_citation/);
    assert.match(expiryPlan, /capability_version/);

    const v1 = `${channelId}@1`;
    const v2 = `${channelId}@2`;
    await queryWithParameters(db, `INSERT INTO capability_version (
      channel_id, version, operation_id, fingerprint, actor_id, reason, status, display_name, product_entry, mode,
      model_version, availability, search_required, citation_capability, region_target, region_actual, limits_summary,
      sop_summary, verified_at, expires_at, public_visible, changed_at
    ) SELECT channel_id, 2, ?, ?, actor_id, reason, status, display_name, product_entry, mode,
      model_version, availability, search_required, citation_capability, region_target, region_actual, limits_summary,
      sop_summary, verified_at, ?, public_visible, changed_at FROM capability_version
      WHERE channel_id = ? AND version = 1`,
    [randomUUID(), "e".repeat(64), "2026-12-01T00:00:00.000Z", channelId]);
    const window = {
      brandId: brand, sourceMode: "model_api", region: "CN", requestedNetworkMode: "on",
      from: "2026-11-22T00:00:00.000Z", to: "2026-11-22T23:59:59.999Z",
    };
    const capturedAt = "2026-11-22T08:00:00.000Z";
    const q1 = randomUUID();
    const q2 = randomUUID();
    async function versioned(version, questionId, recommended, extras = {}) {
      const id = randomUUID();
      await queryWithParameters(db, `INSERT INTO sampling_slot (
        id, plan_id, brand_id, owner_id, channel_id, at, status, manual, cost_minor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      [id, planId, brand, owner, channelId, capturedAt, extras.failed ? "failed" : "completed"]);
      return linkedAnswer(id, {
        version, questionId, recommended, requestedNetworkMode: "on", capturedAt,
        questionText: questionId === q1 ? "版本题一" : "版本题二",
        networkTrigger: "triggered", citationSetState: "missing", ...extras,
      });
    }
    const positive = await versioned(1, q1, "true", { mentioned: "false", citationSetState: "partial" });
    const negative = await versioned(1, q1, "false");
    const q2Ids = [];
    for (let index = 0; index < 3; index++) q2Ids.push(await versioned(1, q2, "true"));
    const networkUnknown = await versioned(1, q1, "true", { networkTrigger: "unknown" });
    await versioned(1, q1, "unknown", { failed: true });
    const otherVersion = await versioned(2, q1, "false", { citationSetState: "complete" });
    const legacy = randomUUID();
    const consumer = randomUUID();
    for (const [id, sourceMode, captureMethod] of [
      [legacy, "model_api", "official_api"], [consumer, "consumer_ui", "manual"],
    ]) {
      await insertScopedObservation(db, {
        id, ownerId: owner, brandId: brand, sourceMode, captureMethod, questionText: "版本题一",
        capturedAt, targetRegion: "CN", observedRegion: "unknown", requestedNetworkMode: "on", recommended: "true",
      });
    }

    const cache = memoryCache();
    const scopedView = (channel, store = cache, actor = owner) => readEvidenceOverview(
      db, actor, { ...window, channel }, store, () => now,
    );
    const noVersion = await scopedView(undefined);
    assert.equal(noVersion.channelSelectionRequired, true);
    assert.deepEqual(noVersion.channelOptions.map((item) => item.value), [v1, v2, "unknown"]);
    assert.equal(noVersion.metrics.recommended.equalWeight, null);
    assert.equal(noVersion.coverage.reason, "channel-selection-required");
    assert.deepEqual(noVersion.answers, []);
    const first = await scopedView(v1);
    const second = await scopedView(v2);
    const ids = (view) => new Set(view.answers.map((answer) => answer.observationId));
    assert.deepEqual(ids(first), new Set([positive, negative, ...q2Ids, networkUnknown]));
    assert.deepEqual(new Set(first.sampleIds), new Set([positive, negative, ...q2Ids]));
    assert.equal(first.metrics.recommended.equalWeight, 0.75);
    assert.deepEqual(first.metrics.recommended.pooled, { numerator: 4, denominator: 5, rate: 0.8 });
    assert.deepEqual(first.metrics.recommended.perQuestion.map(({ questionKey, numerator, denominator }) =>
      [questionKey, numerator, denominator]).sort(), [[q1, 1, 2], [q2, 3, 3]].sort());
    assert.equal(first.metrics.mentioned.pooled.numerator, 4);
    assert.equal(first.metrics.mentioned.pooled.denominator, 5);
    assert.equal(first.metrics.officialSiteCited.pooled.denominator, 0);
    assert.equal(first.metrics.officialSiteCited.status, "na");
    assert.equal(first.metrics.officialSiteCited.reason, "no-complete-citations");
    assert.equal(first.coverage.planned, 7);
    assert.equal(first.coverage.valid, 6);
    assert.equal(first.coverage.eligible, 5);
    assert.equal(first.coverage.failed, 1);
    assert.equal(first.coverage.networkUnknown, 1);
    assert.equal(first.collection.capabilityExpired, true);
    assert.deepEqual(ids(second), new Set([otherVersion]));
    assert.equal(second.metrics.recommended.equalWeight, 0);
    assert.equal(second.coverage.planned, 1);
    assert.equal(second.collection.capabilityExpired, false);
    const historical = await scopedView("unknown");
    assert.deepEqual(ids(historical), new Set([legacy]));
    assert.equal(historical.coverage.planned, 0);
    const consumerView = await readEvidenceOverview(db, owner, { ...window, sourceMode: "consumer_ui" }, cache);
    assert.deepEqual(ids(consumerView), new Set([consumer]));
    assert.deepEqual(await scopedView(v1, cache, await account(db)), { error: "NOT_FOUND" });
    const href = first.nextActions.find((action) => action.kind === "view_answers").href;
    assert.equal(new URL(href, "http://localhost").searchParams.get("channel"), v1);

    const unlinkedSlot = randomUUID();
    await queryWithParameters(db, `INSERT INTO sampling_slot (
      id, plan_id, brand_id, owner_id, channel_id, at, status, manual, cost_minor
    ) VALUES (?, ?, ?, ?, ?, ?, 'failed', 0, 1)`,
    [unlinkedSlot, planId, brand, owner, channelId, capturedAt]);
    const broadWindow = { ...window, region: undefined, requestedNetworkMode: undefined };
    const withoutLink = await readEvidenceOverview(db, owner, { ...broadWindow, channel: v1 }, cache, () => now);
    assert.equal(withoutLink.coverage.planned, 7);
    const unassigned = await readEvidenceOverview(db, owner, { ...broadWindow, channel: "unknown" }, cache, () => now);
    assert.equal(unassigned.coverage.planned, 1);
    await linkedAnswer(unlinkedSlot, { version: 1, questionId: q1, requestedNetworkMode: "on", failed: true });
    const afterLink = await readEvidenceOverview(db, owner, { ...broadWindow, channel: v1 }, cache, () => now);
    assert.equal(afterLink.coverage.planned, 8);
    assert.equal(afterLink.coverage.failed, 2);

    for (const driver of process.env.REDIS_URL ? ["memory", "redis"] : ["memory"]) {
      const writer = driver === "memory" ? memoryCache() : openCache({ ...process.env, GEO_CACHE_DRIVER: "redis" });
      const reader = driver === "memory" ? writer : openCache({ ...process.env, GEO_CACHE_DRIVER: "redis" });
      t.after(() => invalidateEvidenceOverview(owner, brand, writer));
      const context = await evidence.overviewReadContext(owner, brand);
      const expected = { brandId: brand, sourceMode: window.sourceMode, hasOfficialWebsite: true };
      const key = (channel) => overviewCacheIdentity({
        ...expected, ownerId: owner, scope: { ...window, channel }, token: context.token,
      });
      const before = await scopedView(v1, writer);
      await scopedView(v2, writer);
      assert.deepEqual(ids(await readOverviewCache(reader, key(v1), { ...expected, channel: v1 })), ids(first));
      assert.deepEqual(ids(await readOverviewCache(reader, key(v2), { ...expected, channel: v2 })), ids(second));
      const revised = await reviseAnalysis(db, owner, {
        action: "revise-analysis", operationId: randomUUID(), brandId: brand,
        observationId: negative, expectedVersion: driver === "memory" ? 1 : 2,
        mentioned: "true", recommended: driver === "memory" ? "true" : "false",
        officialSiteCited: "unknown", reason: "隔离版本缓存失效验证",
      }, () => now, writer);
      assert.equal(revised.error, undefined);
      assert.equal(await readOverviewCache(reader, key(v1), { ...expected, channel: v1 }), null);
      assert.equal(await readOverviewCache(reader, key(v2), { ...expected, channel: v2 }), null);
      const after = await scopedView(v1, reader);
      assert.notEqual(after.metrics.recommended.equalWeight, before.metrics.recommended.equalWeight);
      assert.equal((await scopedView(v2, reader)).metrics.recommended.equalWeight, 0);
      console.log(`${kind} ${driver} channel cache: independent hits, invalidated by revision`);
    }
    await queryWithParameters(db, "UPDATE answer_observation SET answer_text = ? WHERE id = ?", [
      "[FUNCTIONAL-MOCK] 合成演示", legacy,
    ]);
    const withoutDemo = await scopedView(v1, memoryCache());
    assert.deepEqual(withoutDemo.channelOptions.map((item) => item.value), [v1, v2]);

    const versionQuery = scopedObservationQuery({ ...window, channel: v1, ownerId: owner });
    const versionPlan = await queryWithParameters(db, `${explainPrefix}${versionQuery.sql}`, versionQuery.values);
    assert.match(versionQuery.sql, /s\.channel_id = \?.*s\.channel_version = \?/);
    assert.match(JSON.stringify(versionPlan), /monitoring_slot|INDEX.*s/);
    console.log(`${kind} official channel scope P=7 V=6 E=5 Jm=5 Jr=5 Jc=0; EXPLAIN ${JSON.stringify(versionPlan)}`);
  });
}
