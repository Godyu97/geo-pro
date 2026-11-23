import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import { scopedObservationQuery } from "../../src/features/evidence/dao.ts";
import {
  aggregateOverviewMetrics,
  filterSamplesByScope,
} from "../../src/features/evidence/metrics.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import {
  overviewScopeForReturn,
  overviewScopeFromSearch,
  overviewScopePath,
} from "../../src/features/evidence/overview-contracts.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
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
    hasOfficialWebsite: true,
    ...partial,
  };
}

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
}
