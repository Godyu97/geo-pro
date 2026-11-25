import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { competitorShareBreakdown, orderedRankBreakdown } from "../../src/features/competitor-share/rules.ts";
import {
  readCompetitorShare,
  recordCompetitorMentions,
  saveCompetitorSet,
  shareFromMentions,
} from "../../src/features/competitors/commands.ts";
import { recordMentionsSchema } from "../../src/features/competitors/contracts.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-20T10:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌",
  description: "Synthetic brand for competitor share",
  website: "https://yi.example.com",
  aliases: ["乙"],
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

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Competitor owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function observation(db, owner, brand, text) {
  const saved = await submitManualEvidence(db, owner, {
    action: "submit-manual",
    brandId: brand,
    operationId: randomUUID(),
    questionText: "这个品类里该怎么选？",
    answerText: text,
    region: "CN",
    language: "zh-CN",
    requestedNetworkMode: "unknown",
    entityVersion: 1,
    citationSetState: "complete",
    citations: [],
    locatorRef: `fixture://competitors/${randomUUID()}`,
    collectorId: owner,
    contested: false,
    brandName: "乙品牌",
    aliases: ["乙"],
    officialWebsite: "https://yi.example.com",
    mentioned: "true",
    recommended: "unknown",
    officialSiteCited: "unknown",
  }, clock);
  assert.equal(saved.error, undefined);
  return saved.observation.id;
}

async function slottedObservation(db, owner, brand, questionId, questionText, answerText) {
  const runId = randomUUID();
  const slotId = randomUUID();
  const obsId = randomUUID();
  const fp = createHash("sha256").update(`${slotId}:${questionText}:${answerText}`, "utf8").digest("hex");
  await queryWithParameters(
    db,
    `INSERT INTO monitoring_run (
      id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
      repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
      requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
      status, sampling_complete, created_at
    ) VALUES (?, ?, ?, ?, ?, 'consumer_ui', ?, 1, 1, 1, 1, 1, 1, 'CN', 'zh-CN', 'unknown', NULL, NULL, NULL, 0, 'succeeded', 1, ?)`,
    [runId, brand, owner, randomUUID(), fp, randomUUID(), time],
  );
  await queryWithParameters(
    db,
    `INSERT INTO monitoring_slot (
      id, run_id, brand_id, question_id, natural_question, channel_id, channel_version,
      repeat_index, reservation_id, status, created_at, adopted_attempt_id, late
    ) VALUES (?, ?, ?, ?, 1, 'manual-fixture', 1, 1, NULL, 'queued', ?, NULL, 0)`,
    [slotId, runId, brand, questionId, time],
  );
  await queryWithParameters(
    db,
    `INSERT INTO answer_observation (
      id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method,
      question_text, answer_text, fingerprint, captured_at, region, language,
      requested_network_mode, entity_version, citation_set_state, evidence_state,
      created_at, target_region
    ) VALUES (?, ?, ?, ?, NULL, 'consumer_ui', 'manual', ?, ?, ?, ?, 'CN', 'zh-CN', 'unknown', 1, 'complete', 'complete', ?, 'CN')`,
    [obsId, brand, owner, slotId, questionText, answerText, fp, time, time],
  );
  return obsId;
}

test("repeated mentions in one answer count once and unordered output has no rank", () => {
  const share = shareFromMentions(["甲", "乙"], [
    { observationId: "a1", competitorLabel: "甲", ordered: 0, position: null },
    { observationId: "a1", competitorLabel: "甲", ordered: 0, position: null },
    { observationId: "a1", competitorLabel: "乙", ordered: 0, position: null },
  ]);
  assert.equal(share.rows.find((row) => row.brandId === "甲")?.pooledCount, 1);
  assert.equal(share.rows[0].pooledDenominator, 2);
  assert.equal(share.rows.find((row) => row.brandId === "甲")?.pooledShare, 0.5);
  assert.equal(share.rows.find((row) => row.brandId === "甲")?.equalWeightShare, null);
  assert.equal(share.missingQuestionAnswers.length, 1);
  assert.equal(share.rank.ranked, false);
  assert.equal(share.rank.mean, null);
});

test("an absent competitor is left out of the conditional mean", () => {
  const share = shareFromMentions(["甲", "乙"], [
    { observationId: "a1", competitorLabel: "甲", ordered: 1, position: 1 },
  ]);
  assert.equal(share.rank.ranked, true);
  assert.equal(share.rank.mean, 1);
  assert.deepEqual(share.rank.excludedAbsent, ["乙"]);
  assert.equal(share.rows.find((row) => row.brandId === "乙")?.pooledShare, 0);
});

test("equal-weight share separates from pooled share, keeps zero-mention questions N/A, and excludes unknown answers", () => {
  const breakdown = competitorShareBreakdown(["甲", "乙"], [
    // Q1: 1 answer, 甲 mentioned 3 times -> counts as 1; 乙 false
    { observationId: "a1", questionId: "q1", questionText: "第一题", brandId: "甲", mentionState: "true" },
    { observationId: "a1", questionId: "q1", questionText: "第一题", brandId: "甲", mentionState: "true" },
    { observationId: "a1", questionId: "q1", questionText: "第一题", brandId: "甲", mentionState: "true" },
    { observationId: "a1", questionId: "q1", questionText: "第一题", brandId: "乙", mentionState: "false" },
    // Q2: 5 answers, 乙 mentioned 1 time each; 甲 false
    ...["b1", "b2", "b3", "b4", "b5"].flatMap((id) => [
      { observationId: id, questionId: "q2", questionText: "第二题", brandId: "甲", mentionState: "false" },
      { observationId: id, questionId: "q2", questionText: "第二题", brandId: "乙", mentionState: "true" },
    ]),
    // Q3: zero mentions across fixed set
    { observationId: "c1", questionId: "q3", questionText: "第三题", brandId: "甲", mentionState: "false" },
    { observationId: "c1", questionId: "q3", questionText: "第三题", brandId: "乙", mentionState: "false" },
    // Q4: one unknown member -> excluded from common judgable subset
    { observationId: "d1", questionId: "q4", questionText: "第四题", brandId: "甲", mentionState: "unknown" },
    { observationId: "d1", questionId: "q4", questionText: "第四题", brandId: "乙", mentionState: "true" },
  ]);

  const jia = breakdown.rows.find((row) => row.brandId === "甲");
  const yi = breakdown.rows.find((row) => row.brandId === "乙");
  assert.equal(jia?.equalWeightShare, 0.5);
  assert.equal(yi?.equalWeightShare, 0.5);
  assert.equal(jia?.equalWeightQuestions, 2);
  assert.equal(jia?.coveredQuestions, 3);
  assert.equal(jia?.pooledCount, 1);
  assert.equal(yi?.pooledCount, 5);
  assert.equal(jia?.pooledDenominator, 6);
  assert.ok(Math.abs((jia?.pooledShare ?? 0) - 1 / 6) < 1e-12);
  assert.ok(Math.abs((yi?.pooledShare ?? 0) - 5 / 6) < 1e-12);

  const q3 = breakdown.questions.find((q) => q.questionId === "q3");
  assert.equal(q3?.status, "zero_mentions");
  assert.equal(q3?.brands.every((b) => b.share === null), true);

  const q4 = breakdown.questions.find((q) => q.questionId === "q4");
  assert.equal(q4?.status, "excluded");
  assert.equal(breakdown.excludedAnswers.length, 1);
  assert.deepEqual(breakdown.excludedAnswers[0].unknownBrands, ["甲"]);
  assert.equal(breakdown.summary.zeroMentionQuestions, 1);
  assert.equal(breakdown.summary.excludedQuestions, 1);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: fixed set computes equal-weight and pooled shares, keeps zero-mention N/A, and excludes unknown`, async (t) => {
    if (kind === "postgresql" && !process.env.DATABASE_URL) {
      t.skip("local PostgreSQL URL is not configured");
      return;
    }
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const [owner, outsider] = await Promise.all([account(db), account(db)]);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);
    const firstAnswer = await observation(db, owner, brand, "回答同时写了甲和甲，也写了乙。");
    const secondAnswer = await observation(db, owner, brand, "另一条回答只写了甲。");

    const saved = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["乙", "甲", "甲"] }, clock);
    assert.equal(saved.error, undefined);
    assert.equal(saved.created, true);
    assert.deepEqual(saved.set.labels, ["乙", "甲"]);
    const replay = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["甲", "乙"] }, clock);
    assert.equal(replay.created, false);
    assert.equal(replay.set.id, saved.set.id);

    const recorded = await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: saved.set.id,
      observationId: firstAnswer,
      ordered: false,
      mentions: [{ label: "甲" }, { label: "乙" }],
    }, clock);
    assert.equal(recorded.error, undefined);
    const again = await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: saved.set.id,
      observationId: firstAnswer,
      ordered: false,
      mentions: [{ label: "甲" }],
    }, clock);
    assert.equal(again.error, undefined);
    const conflict = await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: saved.set.id,
      observationId: firstAnswer,
      ordered: true,
      mentions: [{ label: "甲", position: 1 }],
    }, clock);
    assert.equal(conflict.error, "OPERATION_CONFLICT");

    await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: saved.set.id,
      observationId: secondAnswer,
      ordered: false,
      mentions: [{ label: "甲" }],
    }, clock);

    // Unslotted answers enter pooled breakdown and stay in missingQuestionAnswers, not equal-weight mean.
    const unslottedShare = await readCompetitorShare(db, owner, brand);
    assert.equal(unslottedShare.error, undefined);
    assert.equal(unslottedShare.rows.find((row) => row.brandId === "甲")?.pooledCount, 2);
    assert.equal(unslottedShare.rows.find((row) => row.brandId === "乙")?.pooledCount, 1);
    assert.equal(unslottedShare.rows[0].pooledDenominator, 3);
    assert.equal(unslottedShare.rows[0].equalWeightShare, null);
    assert.equal(unslottedShare.missingQuestionAnswers.length, 2);
    assert.equal(unslottedShare.rank.ranked, false);

    // Add slotted answers matching Acceptance 1, 2, 3 in a fresh set version 2
    const v2 = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["甲", "乙", "丁"] }, clock);
    assert.equal(v2.error, undefined);
    assert.equal(v2.set.version, 2);

    const q1 = "11111111-1111-4111-8111-111111111111";
    const q2 = "22222222-2222-4222-8222-222222222222";
    const q3 = "33333333-3333-4333-8333-333333333333";
    const q4 = "44444444-4444-4444-8444-444444444444";

    const q1Obs = await slottedObservation(db, owner, brand, q1, "第一题", "甲甲甲");
    await recordCompetitorMentions(db, owner, {
      brandId: brand, setId: v2.set.id, observationId: q1Obs, ordered: false,
      mentions: [{ label: "甲", state: "true" }, { label: "乙", state: "false" }, { label: "丁", state: "false" }],
    }, clock);

    for (let i = 0; i < 5; i += 1) {
      const q2Obs = await slottedObservation(db, owner, brand, q2, "第二题", `乙回答 ${i + 1}`);
      await recordCompetitorMentions(db, owner, {
        brandId: brand, setId: v2.set.id, observationId: q2Obs, ordered: false,
        mentions: [{ label: "甲", state: "false" }, { label: "乙", state: "true" }, { label: "丁", state: "false" }],
      }, clock);
    }

    const q3Obs = await slottedObservation(db, owner, brand, q3, "第三题", "都不提");
    await recordCompetitorMentions(db, owner, {
      brandId: brand, setId: v2.set.id, observationId: q3Obs, ordered: false,
      mentions: [],
    }, clock);

    const q4Obs = await slottedObservation(db, owner, brand, q4, "第四题", "可能指乙但甲不明确");
    await recordCompetitorMentions(db, owner, {
      brandId: brand, setId: v2.set.id, observationId: q4Obs, ordered: false,
      mentions: [{ label: "甲", state: "unknown" }, { label: "乙", state: "true" }, { label: "丁", state: "false" }],
    }, clock);

    const v2Share = await readCompetitorShare(db, owner, brand, 2);
    assert.equal(v2Share.error, undefined);
    assert.equal(v2Share.rows.find((row) => row.brandId === "甲")?.equalWeightShare, 0.5);
    assert.equal(v2Share.rows.find((row) => row.brandId === "乙")?.equalWeightShare, 0.5);
    assert.equal(v2Share.rows.find((row) => row.brandId === "丁")?.equalWeightShare, 0);
    assert.equal(v2Share.rows.find((row) => row.brandId === "甲")?.pooledCount, 1);
    assert.equal(v2Share.rows.find((row) => row.brandId === "乙")?.pooledCount, 5);
    assert.equal(v2Share.rows[0].pooledDenominator, 6);
    assert.equal(v2Share.summary.coveredQuestions, 3);
    assert.equal(v2Share.summary.equalWeightQuestions, 2);
    assert.equal(v2Share.summary.zeroMentionQuestions, 1);
    assert.equal(v2Share.summary.excludedQuestions, 1);
    assert.equal(v2Share.questions.find((q) => q.questionId === q3)?.status, "zero_mentions");
    assert.equal(v2Share.questions.find((q) => q.questionId === q4)?.status, "excluded");
    assert.equal(v2Share.excludedAnswers.length, 1);
    assert.equal(v2Share.rank.unorderedCount, 7);

    const outside = await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: saved.set.id,
      observationId: secondAnswer,
      ordered: false,
      mentions: [{ label: "丙" }],
    }, clock);
    assert.equal(outside.error, "INVALID_INPUT");

    // Switching to v3 leaves v1 and v2 untouched
    const next = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["甲", "丙"] }, clock);
    assert.equal(next.created, true);
    assert.equal(next.set.version, 3);
    const v1Check = await readCompetitorShare(db, owner, brand, 1);
    assert.equal(v1Check.rows.find((row) => row.brandId === "甲")?.pooledCount, 2);
    const v2Check = await readCompetitorShare(db, owner, brand, 2);
    assert.equal(v2Check.rows.find((row) => row.brandId === "甲")?.equalWeightShare, 0.5);
    const fresh = await readCompetitorShare(db, owner, brand, 3);
    assert.equal(fresh.rows.find((row) => row.brandId === "甲")?.pooledCount, 0);
    assert.equal(fresh.rows.find((row) => row.brandId === "丙")?.equalWeightShare, null);
    assert.equal(fresh.rows.find((row) => row.brandId === "丙")?.pooledShare, null);

    // Query plan check for listMentions join
    const explainSql = kind === "sqlite"
      ? `EXPLAIN QUERY PLAN SELECT m.id, s.question_id FROM competitor_mention m
         JOIN answer_observation o ON o.id = m.observation_id AND o.brand_id = m.brand_id AND o.owner_id = m.owner_id
         LEFT JOIN monitoring_slot s ON s.id = o.slot_id
         WHERE m.owner_id = ? AND m.brand_id = ? AND m.set_id = ?
         ORDER BY m.created_at ASC, m.id ASC`
      : `EXPLAIN SELECT m.id, s.question_id FROM competitor_mention m
         JOIN answer_observation o ON o.id = m.observation_id AND o.brand_id = m.brand_id AND o.owner_id = m.owner_id
         LEFT JOIN monitoring_slot s ON s.id = o.slot_id
         WHERE m.owner_id = ? AND m.brand_id = ? AND m.set_id = ?
         ORDER BY m.created_at ASC, m.id ASC`;
    const planRows = await queryWithParameters(db, explainSql, [owner, brand, v2.set.id]);
    assert.ok(planRows.length > 0);

    const denied = await readCompetitorShare(db, outsider, brand);
    assert.equal(denied.error, "NOT_FOUND");
    await queryWithParameters(db, "UPDATE brand SET frozen_at = ? WHERE id = ?", [time, brand]);
    const frozen = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["甲"] }, clock);
    assert.equal(frozen.error, "NOT_FOUND");
    await queryWithParameters(db, "UPDATE brand SET frozen_at = NULL WHERE id = ?", [brand]);

    await new PurgeDao(db).clearContents({ ownerId: owner, brandId: brand }, time);
    const left = await queryWithParameters(db, "SELECT id FROM competitor_set WHERE brand_id = ?", [brand]);
    assert.equal(left.length, 0);
  });
}

test("ordered rank breakdown computes appearance, first-place, and conditional mean while excluding unordered and unknown", () => {
  const result = orderedRankBreakdown(["甲", "乙", "丙"], [
    { observationId: "o1", brandId: "甲", mentionState: "true", ordered: 1, position: 1 },
    { observationId: "o1", brandId: "乙", mentionState: "false", ordered: 1, position: null },
    { observationId: "o1", brandId: "丙", mentionState: "false", ordered: 1, position: null },
    { observationId: "o2", brandId: "甲", mentionState: "true", ordered: 1, position: 3 },
    { observationId: "o2", brandId: "乙", mentionState: "false", ordered: 1, position: null },
    { observationId: "o2", brandId: "丙", mentionState: "false", ordered: 1, position: null },
    { observationId: "o3", brandId: "甲", mentionState: "false", ordered: 1, position: null },
    { observationId: "o3", brandId: "乙", mentionState: "false", ordered: 1, position: null },
    { observationId: "o3", brandId: "丙", mentionState: "false", ordered: 1, position: null },
    { observationId: "o4", brandId: "甲", mentionState: "false", ordered: 1, position: null },
    { observationId: "o4", brandId: "乙", mentionState: "false", ordered: 1, position: null },
    { observationId: "o4", brandId: "丙", mentionState: "unknown", ordered: 1, position: null },
    { observationId: "u1", questionText: "1. 标题一 2. 标题二", brandId: "甲", mentionState: "true", ordered: 0, position: null },
    { observationId: "u1", questionText: "1. 标题一 2. 标题二", brandId: "乙", mentionState: "true", ordered: 0, position: null },
  ]);

  assert.equal(result.ranked, true);
  assert.equal(result.orderedObservations, 4);
  assert.equal(result.unorderedObservations, 1);
  assert.deepEqual(result.excludedAbsent, ["乙", "丙"]);
  assert.deepEqual(result.observations.map((obs) => obs.observationId), ["o1", "o2", "o3", "o4"]);

  const jia = result.rows.find((row) => row.brandId === "甲");
  assert.equal(jia?.judgableCount, 4);
  assert.equal(jia?.appearedCount, 2);
  assert.equal(jia?.firstPlaceCount, 1);
  assert.equal(jia?.appearanceRate, 0.5);
  assert.equal(jia?.firstPlaceRate, 0.25);
  assert.equal(jia?.conditionalMeanPosition, 2);

  const yi = result.rows.find((row) => row.brandId === "乙");
  assert.equal(yi?.judgableCount, 4);
  assert.equal(yi?.appearedCount, 0);
  assert.equal(yi?.firstPlaceCount, 0);
  assert.equal(yi?.appearanceRate, 0);
  assert.equal(yi?.firstPlaceRate, 0);
  assert.equal(yi?.conditionalMeanPosition, null);

  const bing = result.rows.find((row) => row.brandId === "丙");
  assert.equal(bing?.judgableCount, 3);
  assert.equal(bing?.unknownCount, 1);
  assert.equal(bing?.appearanceRate, 0);
  assert.equal(bing?.conditionalMeanPosition, null);

  const onlyUnordered = orderedRankBreakdown(["甲", "乙"], [
    { observationId: "u1", questionText: "1. 第一点\n2. 第二点", brandId: "甲", mentionState: "true", ordered: 0, position: null },
  ]);
  assert.equal(onlyUnordered.ranked, false);
  assert.equal(onlyUnordered.orderedObservations, 0);
  assert.equal(onlyUnordered.unorderedObservations, 1);
  assert.equal(onlyUnordered.observations.length, 0);

  const allAbsentOrdered = orderedRankBreakdown(["甲", "乙"], [
    { observationId: "a1", brandId: "甲", mentionState: "false", ordered: 1, position: null },
    { observationId: "a1", brandId: "乙", mentionState: "false", ordered: 1, position: null },
  ]);
  assert.equal(allAbsentOrdered.ranked, true);
  assert.equal(allAbsentOrdered.orderedObservations, 1);
  assert.equal(allAbsentOrdered.rows[0].appearanceRate, 0);
  assert.equal(allAbsentOrdered.rows[0].judgableCount, 1);
  assert.equal(allAbsentOrdered.rows[0].conditionalMeanPosition, null);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: ordered observations track appearance, first-place, conditional mean, and refuse position on unordered`, async (t) => {
    if (kind === "postgresql" && !process.env.DATABASE_URL) {
      t.skip("local PostgreSQL URL is not configured");
      return;
    }
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const [owner, outsider] = await Promise.all([account(db), account(db)]);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);

    const set1 = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["甲", "乙"] }, clock);
    assert.equal(set1.error, undefined);

    const unorderedObs = await observation(db, owner, brand, "1. 先看参数 2. 再看售后，这里只列特点不排名，提到甲和乙。");
    const badUnordered = recordMentionsSchema.safeParse({
      brandId: brand,
      setId: set1.set.id,
      observationId: unorderedObs,
      ordered: false,
      mentions: [{ label: "甲", state: "true", position: 1 }],
    });
    assert.equal(badUnordered.success, false);

    const badAbsentPos = recordMentionsSchema.safeParse({
      brandId: brand,
      setId: set1.set.id,
      observationId: unorderedObs,
      ordered: true,
      mentions: [{ label: "甲", state: "false", position: 1 }],
    });
    assert.equal(badAbsentPos.success, false);

    const savedUnordered = await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: set1.set.id,
      observationId: unorderedObs,
      ordered: false,
      mentions: [{ label: "甲", state: "true" }, { label: "乙", state: "true" }],
    }, clock);
    assert.equal(savedUnordered.error, undefined);

    const rewriteAttempt = await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: set1.set.id,
      observationId: unorderedObs,
      ordered: true,
      mentions: [{ label: "甲", state: "true", position: 1 }, { label: "乙", state: "true", position: 2 }],
    }, clock);
    assert.equal(rewriteAttempt.error, "OPERATION_CONFLICT");

    const unorderedOnly = await readCompetitorShare(db, owner, brand, 1);
    assert.equal(unorderedOnly.error, undefined);
    assert.equal(unorderedOnly.rank.ranked, false);
    assert.equal(unorderedOnly.rank.orderedObservations, 0);
    assert.equal(unorderedOnly.rank.unorderedObservations, 1);

    const o1 = await observation(db, owner, brand, "有序推荐 1：第一名甲，未提乙");
    const o2 = await observation(db, owner, brand, "有序推荐 2：第三名甲，未提乙");
    const o3 = await observation(db, owner, brand, "有序推荐 3：推荐丙，甲乙未上榜");
    const o4 = await observation(db, owner, brand, "有序推荐 4：推荐丁，甲乙未上榜");

    assert.equal((await recordCompetitorMentions(db, owner, {
      brandId: brand, setId: set1.set.id, observationId: o1, ordered: true,
      mentions: [{ label: "甲", state: "true", position: 1 }, { label: "乙", state: "false" }],
    }, clock)).error, undefined);
    assert.equal((await recordCompetitorMentions(db, owner, {
      brandId: brand, setId: set1.set.id, observationId: o2, ordered: true,
      mentions: [{ label: "甲", state: "true", position: 3 }, { label: "乙", state: "false" }],
    }, clock)).error, undefined);
    assert.equal((await recordCompetitorMentions(db, owner, {
      brandId: brand, setId: set1.set.id, observationId: o3, ordered: true,
      mentions: [{ label: "甲", state: "false" }, { label: "乙", state: "false" }],
    }, clock)).error, undefined);
    assert.equal((await recordCompetitorMentions(db, owner, {
      brandId: brand, setId: set1.set.id, observationId: o4, ordered: true,
      mentions: [],
    }, clock)).error, undefined);

    const share = await readCompetitorShare(db, owner, brand, 1);
    assert.equal(share.error, undefined);
    assert.equal(share.rank.ranked, true);
    assert.equal(share.rank.orderedObservations, 4);
    assert.equal(share.rank.unorderedObservations, 1);
    assert.equal(share.rank.unorderedCount, 2);
    assert.deepEqual(share.rank.excludedAbsent, ["乙"]);
    assert.deepEqual(
      share.rank.observations.map((obs) => obs.observationId).sort(),
      [o1, o2, o3, o4].sort(),
    );

    const jia = share.rank.rows.find((row) => row.brandId === "甲");
    assert.equal(jia?.judgableCount, 4);
    assert.equal(jia?.appearedCount, 2);
    assert.equal(jia?.firstPlaceCount, 1);
    assert.equal(jia?.appearanceRate, 0.5);
    assert.equal(jia?.firstPlaceRate, 0.25);
    assert.equal(jia?.conditionalMeanPosition, 2);

    const yi = share.rank.rows.find((row) => row.brandId === "乙");
    assert.equal(yi?.judgableCount, 4);
    assert.equal(yi?.appearedCount, 0);
    assert.equal(yi?.firstPlaceCount, 0);
    assert.equal(yi?.appearanceRate, 0);
    assert.equal(yi?.firstPlaceRate, 0);
    assert.equal(yi?.conditionalMeanPosition, null);

    // Version 2 with only ordered samples where all brands are absent
    const set2 = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["戊"] }, clock);
    assert.equal(set2.error, undefined);
    assert.equal((await recordCompetitorMentions(db, owner, {
      brandId: brand, setId: set2.set.id, observationId: o3, ordered: true,
      mentions: [{ label: "戊", state: "false" }],
    }, clock)).error, undefined);
    const v2 = await readCompetitorShare(db, owner, brand, 2);
    assert.equal(v2.error, undefined);
    assert.equal(v2.rank.ranked, true);
    assert.equal(v2.rank.orderedObservations, 1);
    assert.equal(v2.rank.rows[0].appearanceRate, 0);
    assert.equal(v2.rank.rows[0].firstPlaceRate, 0);
    assert.equal(v2.rank.rows[0].judgableCount, 1);
    assert.equal(v2.rank.rows[0].conditionalMeanPosition, null);
    assert.deepEqual(v2.rank.excludedAbsent, ["戊"]);

    assert.equal((await readCompetitorShare(db, outsider, brand)).error, "NOT_FOUND");
  });
}
