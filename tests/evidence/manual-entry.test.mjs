import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { memoryCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  completeManualEvidence,
  readObservation,
  submitManualEvidence,
} from "../../src/features/evidence/commands.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-25T02:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌",
  description: "Synthetic brand for manual evidence",
  website: "https://yi.example.com",
  aliases: ["乙"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

function manual(brandId, overrides = {}) {
  return {
    action: "submit-manual",
    brandId,
    operationId: randomUUID(),
    questionText: "消费者人工存证问题",
    answerText: "甲可考虑；乙不适合本需求。",
    region: "CN",
    language: "zh-CN",
    requestedNetworkMode: "unknown",
    targetRegion: "CN",
    observedRegion: "unknown",
    newSession: "unknown",
    productMode: "unknown",
    entityVersion: 1,
    citationSetState: "complete",
    citations: [],
    locatorRef: "fixture://manual/locator",
    collectorId: "collector-1",
    contested: false,
    brandName: "乙品牌",
    aliases: ["乙"],
    officialWebsite: "https://yi.example.com",
    ...overrides,
  };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Manual owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function counts(db, brandId) {
  const [observations] = await queryWithParameters(
    db,
    "SELECT COUNT(*) AS count FROM answer_observation WHERE brand_id = ?",
    [brandId],
  );
  const [citations] = await queryWithParameters(
    db,
    "SELECT COUNT(*) AS count FROM answer_citation WHERE brand_id = ?",
    [brandId],
  );
  return { observations: Number(observations.count), citations: Number(citations.count) };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: consumer manual draft, citation dedupe, and locked original text`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const owner = await account(db);
    const outsider = await account(db);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);
    const cache = memoryCache();

    const draft = await submitManualEvidence(db, owner, manual(brand, {
      citationSetState: "missing",
      locatorRef: null,
      answerText: "先记下回答，定位符稍后补。",
    }), clock, cache);
    assert.equal(draft.error, "EVIDENCE_INCOMPLETE");
    assert.equal(draft.observation.evidenceState, "draft_evidence");
    assert.equal(draft.observation.missingReason, "citation-fields-missing,locator-missing");
    assert.equal(draft.latestAnalysis, null);
    const draftView = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "consumer_ui" }, cache);
    assert.equal(draftView.answers.some((item) => item.observationId === draft.observation.id), false);
    assert.equal(draftView.sampleIds.includes(draft.observation.id), false);
    assert.equal(draftView.metrics.mentioned.status, "na");

    const beforeReject = await counts(db, brand);
    const leaked = await completeManualEvidence(db, owner, {
      ...manual(brand, { action: "complete-manual", observationId: draft.observation.id }),
      locatorRef: "session_token=abc",
      citationSetState: "complete",
    }, clock, cache);
    assert.equal(leaked.error, "INVALID_INPUT");
    assert.deepEqual(await counts(db, brand), beforeReject);
    const stillDraft = await readObservation(db, owner, draft.observation.id);
    assert.equal(stillDraft.observation.evidenceState, "draft_evidence");
    assert.equal(stillDraft.observation.answerText, "先记下回答，定位符稍后补。");

    const firstUrl = "https://shop.example.com/a?utm_source=x&id=1";
    const duplicateUrl = "https://shop.example.com/a?gclid=zzz&id=1";
    const distinctUrl = "https://shop.example.com/a?id=2";
    const operationId = randomUUID();
    const completed = await completeManualEvidence(db, owner, {
      ...manual(brand, {
        action: "complete-manual",
        observationId: draft.observation.id,
        operationId,
        answerText: "甲可考虑；乙不适合本需求。",
      }),
      citations: [
        { rawUrl: firstUrl, citationOrigin: "consumer_visible", positionLabel: "top" },
        { rawUrl: duplicateUrl, citationOrigin: "consumer_visible", positionLabel: "bottom" },
        { rawUrl: distinctUrl, citationOrigin: "consumer_visible", positionLabel: "side" },
      ],
    }, clock, cache);
    assert.equal(completed.error, undefined);
    assert.equal(completed.observation.id, draft.observation.id);
    assert.equal(completed.observation.evidenceState, "complete");
    assert.equal(completed.observation.sourceMode, "consumer_ui");
    assert.equal(completed.citations.length, 2);
    assert.equal(completed.citations[0].rawUrl, firstUrl);
    assert.equal(completed.citations[0].positionLabel, "top");
    assert.equal(completed.citations[0].normalizedUrl, "https://shop.example.com/a?id=1");
    assert.equal(completed.citations[1].rawUrl, distinctUrl);
    assert.equal(completed.latestAnalysis.version, 1);
    assert.equal(completed.analyses.length, 1);

    const consumerView = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "consumer_ui" }, cache);
    assert.equal(consumerView.answers.some((item) => item.observationId === draft.observation.id), true);
    assert.equal(consumerView.sampleIds.includes(draft.observation.id), true);
    const apiView = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "model_api" }, cache);
    assert.equal(apiView.sampleIds.includes(draft.observation.id), false);

    const replay = await completeManualEvidence(db, owner, {
      ...manual(brand, { action: "complete-manual", observationId: draft.observation.id, operationId }),
    }, clock, cache);
    assert.equal(replay.observation.id, draft.observation.id);
    assert.equal(replay.latestAnalysis.version, 1);
    assert.equal((await readObservation(db, owner, draft.observation.id)).analyses.length, 1);

    const locked = await completeManualEvidence(db, owner, {
      ...manual(brand, {
        action: "complete-manual",
        observationId: draft.observation.id,
        answerText: "覆盖原文不应成功",
      }),
    }, clock, cache);
    assert.equal(locked.error, "EVIDENCE_LOCKED");
    const unchanged = await readObservation(db, owner, draft.observation.id);
    assert.equal(unchanged.observation.answerText, "甲可考虑；乙不适合本需求。");
    assert.equal(unchanged.analyses.length, 1);
    assert.equal(await readObservation(db, outsider, draft.observation.id), null);

    const contested = await submitManualEvidence(db, owner, manual(brand, {
      questionText: "待复核的人工存证",
      contested: true,
      citations: [{ rawUrl: "https://shop.example.com/review", citationOrigin: "consumer_visible" }],
    }), clock, cache);
    assert.equal(contested.observation.evidenceState, "contested");
    assert.equal(contested.latestAnalysis.version, 1);
    assert.equal(contested.latestAnalysis.status, "needs_review");
    const contestedLock = await completeManualEvidence(db, owner, {
      ...manual(brand, { action: "complete-manual", observationId: contested.observation.id, answerText: "不能改" }),
    }, clock, cache);
    assert.equal(contestedLock.error, "EVIDENCE_LOCKED");

    const partialDraft = await submitManualEvidence(db, owner, manual(brand, {
      questionText: "有争议标记但缺定位符",
      contested: true,
      locatorRef: null,
    }), clock, cache);
    assert.equal(partialDraft.observation.evidenceState, "draft_evidence");
    assert.match(partialDraft.observation.missingReason, /locator-missing/);

    const beforeSecrets = await counts(db, brand);
    for (const secret of [
      { answerText: "the password is hidden", locatorRef: "fixture://ok" },
      { answerText: "ordinary answer", locatorRef: "cookie=abc" },
      { answerText: "ordinary answer", locatorRef: "session_token=abc" },
    ]) {
      const rejected = await submitManualEvidence(db, owner, manual(brand, {
        questionText: `secret ${secret.locatorRef}`,
        ...secret,
      }), clock, cache);
      assert.equal(rejected.error, "INVALID_INPUT");
    }
    assert.deepEqual(await counts(db, brand), beforeSecrets);

    const planSql = "UPDATE answer_observation SET missing_reason = missing_reason WHERE id = ? AND owner_id = ? AND brand_id = ? AND evidence_state = 'draft_evidence'";
    const plan = await queryWithParameters(
      db,
      `${kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN "}${planSql}`,
      [draft.observation.id, owner, brand],
    );
    const planText = plan.map((row) => JSON.stringify(row)).join("\n");
    console.log(`${kind} draft update plan\n${planText}`);
    assert.match(planText, kind === "postgresql" ? /Index Scan using answer_observation_owner_idx/ : /sqlite_autoindex_answer_observation_1/);
  });
}
