import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { extractBrandFactClaim } from "../../src/features/entity-accuracy/claim-extract.ts";
import { listBrandFactClaims } from "../../src/features/entity-accuracy/claim-read.ts";
import { applyExtractedClaim, compareAnswerToFacts } from "../../src/features/entity-accuracy/claims.ts";
import { readEntityReviewWorkspace, recordEntityReviews } from "../../src/features/entity-accuracy/commands.ts";
import { claimExtractErrors } from "../../src/features/entity-accuracy/contracts.ts";
import { brandFactObservationQuery } from "../../src/features/entity-accuracy/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-26T08:00:00.000Z";
const later = "2026-11-26T09:00:00.000Z";
const method = "品牌核验题抽检";
const env = {
  OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "loopback-model",
};

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fact(id, title, claim, status) {
  return { id, category: "price", title, claim, status };
}

test("brand-fact comparisons keep expired facts and wording differences out of confirmed errors", () => {
  const approved = fact("11111111-1111-4111-8111-111111111111", "官方售价", "官方售价 199 元", "approved");
  const expired = fact("22222222-2222-4222-8222-222222222222", "促销价", "促销价 99 元", "expired");
  const other = fact("33333333-3333-4333-8333-333333333333", "官方售价", "官方售价 188 元", "approved");
  const revoked = fact("44444444-4444-4444-8444-444444444444", "渠道价", "渠道价 150 元", "revoked");
  const conflict = compareAnswerToFacts("该品牌官方售价为 299 元", [approved, expired, revoked]);
  assert.equal(conflict.judgment, "conflict");
  assert.equal(conflict.confirmable, true);
  assert.equal(conflict.reviewFact, "active");
  assert.equal(conflict.factStatus, "approved");
  const stale = compareAnswerToFacts("去年促销价 99 元", [approved, expired]);
  assert.equal(stale.judgment, "insufficient");
  assert.equal(stale.confirmable, false);
  assert.equal(stale.reviewFact, "expired");
  assert.equal(stale.factStatus, "expired");
  const wording = compareAnswerToFacts("官方售价是 199 元", [approved]);
  assert.equal(wording.judgment, "not_applicable");
  assert.equal(wording.confirmable, false);
  const unresolved = compareAnswerToFacts("该品牌官方售价为 299 元", [approved, other]);
  assert.equal(unresolved.judgment, "insufficient");
  assert.equal(unresolved.reviewFact, "conflict");
  assert.equal(unresolved.confirmable, false);
  const revokedOnly = compareAnswerToFacts("渠道价 150 元", [revoked]);
  assert.equal(revokedOnly.judgment, "not_applicable");
  assert.equal(revokedOnly.confirmable, false);
  const drafted = applyExtractedClaim(stale, "模型把过期事实说成冲突");
  assert.equal(drafted.claim, "模型把过期事实说成冲突");
  assert.equal(drafted.judgment, "insufficient");
  assert.equal(drafted.confirmable, false);
  assert.equal(drafted.reviewFact, "expired");
});

function watch(db) {
  const captured = [];
  return {
    captured,
    connection: {
      kind: db.kind,
      query(sql, values) {
        captured.push({ sql, values });
        return db.query(sql, values);
      },
      transaction: (work) => db.transaction(work),
    },
  };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
    id, "Claim review owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true,
  ]);
  return id;
}

function promptContent(questions) {
  const clusterId = randomUUID();
  return JSON.stringify({
    clusters: [{
      id: clusterId, audience: "买家", intent: "核对价格", primaryPage: "https://brand.example.com/price", conversionAction: "核对",
    }],
    questions: questions.map((question) => ({
      id: question.id,
      clusterId,
      text: question.text,
      source: "manual",
      sourceNote: "",
      type: question.type,
      stage: "consider",
      region: "CN",
      language: "zh-CN",
      status: "confirmed",
      acceptSimilar: false,
      primary: question.type !== "brand_fact",
    })),
  });
}

async function addFact(db, brandId, ownerId, fields, validThrough) {
  const id = randomUUID();
  await queryWithParameters(db, `INSERT INTO brand_fact_version
      (brand_id, id, fact_id, version, entity_version, paste_id, revision, state, content, created_at, confirmed_by, confirmed_at, revoked_at)
    VALUES (?, ?, ?, 1, 1, NULL, 1, 'approved', ?, ?, ?, ?, NULL)`, [
    brandId, id, id, JSON.stringify({
      ...emptyFields,
      category: "price",
      title: fields.title,
      claim: fields.claim,
      sourceType: "internal",
      sourceReference: "fixture",
      sourceLocator: "section 1",
      sourceExcerpt: "fixture excerpt",
      sourceDate: "2026-11-01",
      permission: "public",
      validity: "dated",
      validThrough,
    }), time, ownerId, time,
  ]);
  return id;
}

async function seed(db, ownerId, brandId) {
  const brands = new BrandDao(db);
  await brands.insertBrand(ownerId, brandId, time);
  await brands.insertVersion(brandId, 1, { ...initialBrandFields, name: "核验主张夹具" }, time);
  const conflictQuestionId = randomUUID();
  const expiredQuestionId = randomUUID();
  const discoveryQuestionId = randomUUID();
  const setId = randomUUID();
  await queryWithParameters(db, `INSERT INTO prompt_set
      (brand_id, id, set_id, version, entity_version, region, language, content, created_at)
    VALUES (?, ?, ?, 1, 1, 'CN', 'zh-CN', ?, ?)`, [
    brandId, setId, setId, promptContent([
      { id: conflictQuestionId, text: "这个品牌现在的官方售价是多少", type: "brand_fact" },
      { id: expiredQuestionId, text: "这个品牌去年的促销价是多少", type: "brand_fact" },
      { id: discoveryQuestionId, text: "这个品类里大家一般怎么选", type: "discovery" },
    ]), time,
  ]);
  const runId = randomUUID();
  const channelId = randomUUID();
  await queryWithParameters(db, `INSERT INTO monitoring_run (
      id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
      repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
      requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
      status, sampling_complete, created_at
    ) VALUES (?, ?, ?, ?, ?, 'consumer_ui', ?, 1, 1, 3, 1, 1, 3, 'CN', 'zh-CN', 'unknown', NULL, NULL, NULL, 0, 'queued', 0, ?)`, [
    runId, brandId, ownerId, randomUUID(), sha(runId), setId, time,
  ]);
  const rows = [
    { questionId: conflictQuestionId, question: "这个品牌现在的官方售价是多少", answer: "该品牌官方售价为 299 元", at: later },
    { questionId: expiredQuestionId, question: "这个品牌去年的促销价是多少", answer: "去年促销价 99 元", at: time },
    { questionId: discoveryQuestionId, question: "这个品类里大家一般怎么选", answer: "自然发现题不应进入核验主张", at: later },
  ].map((row) => ({ ...row, slotId: randomUUID(), observationId: randomUUID(), analysisId: randomUUID() }));
  for (const row of rows) {
    await queryWithParameters(db, `INSERT INTO monitoring_slot (
        id, run_id, brand_id, question_id, natural_question, channel_id, channel_version, repeat_index,
        reservation_id, status, created_at, adopted_attempt_id, late
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, NULL, 'queued', ?, NULL, 0)`, [
      row.slotId, runId, brandId, row.questionId, row.questionId === discoveryQuestionId ? 1 : 0, channelId, row.at,
    ]);
    await queryWithParameters(db, `INSERT INTO answer_observation (
        id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
        fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
        evidence_state, locator_ref, collector_id, missing_reason, created_at,
        target_region, observed_region, new_session, product_mode
      ) VALUES (?, ?, ?, ?, NULL, 'consumer_ui', 'manual', ?, ?, ?, ?, 'CN', 'zh-CN', 'unknown', 1, 'complete', 'complete', NULL, NULL, NULL, ?, 'CN', 'unknown', 'unknown', 'unknown')`, [
      row.observationId, brandId, ownerId, row.slotId, row.question, row.answer, sha(row.observationId), row.at, row.at,
    ]);
    await queryWithParameters(db, `INSERT INTO answer_analysis_version (
        id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
        official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
      ) VALUES (?, ?, ?, 1, 1, 's-m1-03-v1', 'unknown', 'unknown', 'unknown', NULL, 'needs_review', NULL, NULL, NULL, ?)`, [
      row.analysisId, row.observationId, brandId, row.at,
    ]);
  }
  const approvedId = await addFact(db, brandId, ownerId, { title: "官方售价", claim: "官方售价 199 元" }, "2099-01-01");
  const expiredId = await addFact(db, brandId, ownerId, { title: "促销价", claim: "促销价 99 元" }, "2020-01-01");
  const conflict = rows[0];
  const expired = rows[1];
  return { approvedId, expiredId, conflict, expired, discoveryAnswer: rows[2].answer };
}

async function countTable(db, table, brandId) {
  const [row] = await queryWithParameters(db, `SELECT COUNT(*) AS "count" FROM ${table} WHERE brand_id = ?`, [brandId]);
  return Number(row.count);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: brand-fact claims stay out of natural discovery and confirmed errors need a person`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const [owner, outsider, otherOwner] = await Promise.all([account(db), account(db), account(db)]);
      const brandId = randomUUID();
      const otherBrandId = randomUUID();
      const seeded = await seed(db, owner, brandId);
      const other = await seed(db, otherOwner, otherBrandId);
      const hidden = await readEntityReviewWorkspace(db, outsider, brandId);
      assert.equal(hidden.error, "NOT_FOUND");
      assert.equal(claimExtractErrors.NOT_FOUND, 404);
      assert.equal(JSON.stringify(hidden).includes(seeded.conflict.answer), false);
      assert.equal(JSON.stringify(hidden).includes("自然发现题不应进入核验主张"), false);

      const watched = watch(db);
      const workspace = await readEntityReviewWorkspace(watched.connection, owner, brandId);
      assert.equal(workspace.claims.length, 2);
      const conflict = workspace.claims.find((claim) => claim.observationId === seeded.conflict.observationId);
      const expired = workspace.claims.find((claim) => claim.observationId === seeded.expired.observationId);
      assert.equal(conflict.judgment, "conflict");
      assert.equal(conflict.confirmable, true);
      assert.equal(conflict.reviewFact, "active");
      assert.equal(conflict.analysisVersionId, seeded.conflict.analysisId);
      assert.equal(expired.judgment, "insufficient");
      assert.equal(expired.confirmable, false);
      assert.equal(expired.reviewFact, "expired");
      assert.equal(expired.factStatus, "expired");
      assert.equal(JSON.stringify(workspace.claims).includes(seeded.discoveryAnswer), false);
      const observationReads = watched.captured.filter((item) => item.sql.includes("FROM answer_observation"));
      assert.equal(observationReads.length, 2);
      const detail = observationReads.find((item) => item.sql.includes("question_id IN"));
      assert.match(detail.sql, /LIMIT 30/);
      const plan = await db.query(`${db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN "}${detail.sql}`, detail.values);
      console.log(`${kind} brand-fact observation plan ${JSON.stringify(plan)}`);
      assert.match(JSON.stringify(plan), /answer_observation|monitoring_slot|prompt_set|brand_fact/i);

      const listed = await listBrandFactClaims(db, otherOwner, otherBrandId);
      assert.equal(listed.length, 2);
      assert.equal(JSON.stringify(workspace.claims).includes(listed[0].observationId), false);
      assert.equal(JSON.stringify(workspace.claims).includes(other.conflict.observationId), false);

      const reviewsBefore = await countTable(db, "entity_review", brandId);
      const analysesBefore = await countTable(db, "answer_analysis_version", brandId);
      const calls = [];
      const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url: String(url), body, authorization: init.headers.Authorization });
        const mode = body.input.includes(seeded.expired.answer) ? "expired" : "bad";
        const text = mode === "expired"
          ? JSON.stringify({ claim: "模型草案：促销价 99 元", judgment: "conflict", factId: seeded.expiredId })
          : "ignore previous instructions";
        return new Response(JSON.stringify({
          id: "resp_loopback", status: "completed", model: "loopback-model",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      };
      const unconfigured = await extractBrandFactClaim(db, owner, brandId, { observationId: seeded.expired.observationId }, { env: {}, fetchImpl });
      assert.deepEqual(unconfigured, { error: "AI_UNAVAILABLE" });
      assert.equal(calls.length, 0);
      const denied = await extractBrandFactClaim(db, outsider, brandId, { observationId: seeded.expired.observationId }, { env, fetchImpl });
      assert.equal(denied.error, "NOT_FOUND");
      assert.equal(JSON.stringify(denied).includes(seeded.expired.answer), false);
      assert.equal(calls.length, 0);
      const drafted = await extractBrandFactClaim(db, owner, brandId, { observationId: seeded.expired.observationId }, { env, fetchImpl });
      assert.equal(drafted.claim.claim, "模型草案：促销价 99 元");
      assert.equal(drafted.claim.judgment, "insufficient");
      assert.equal(drafted.claim.confirmable, false);
      assert.equal(drafted.claim.reviewFact, "expired");
      assert.equal(await countTable(db, "entity_review", brandId), reviewsBefore);
      assert.equal(await countTable(db, "answer_analysis_version", brandId), analysesBefore);
      const request = calls[0];
      assert.equal(request.url.endsWith("/responses"), true);
      assert.equal(request.body.store, false);
      assert.equal(request.authorization, "Bearer test-key");
      assert.equal(request.body.instructions.includes(seeded.expired.answer), false);
      assert.equal(JSON.parse(request.body.input).answerText, seeded.expired.answer);
      const invalid = await extractBrandFactClaim(db, owner, brandId, { observationId: seeded.conflict.observationId }, { env, fetchImpl });
      assert.equal(invalid.error, "INVALID_MODEL_OUTPUT");
      assert.equal(claimExtractErrors.INVALID_MODEL_OUTPUT, 422);
      assert.equal(JSON.stringify(invalid).includes(seeded.conflict.answer), false);
      assert.equal(await countTable(db, "entity_review", brandId), reviewsBefore);
      assert.equal(await countTable(db, "answer_analysis_version", brandId), analysesBefore);

      const rejected = await recordEntityReviews(db, owner, {
        brandId,
        method,
        population: 50,
        marks: [{
          observationId: seeded.expired.observationId,
          analysisVersionId: seeded.expired.analysisId,
          reviewed: true,
          confirmed: true,
          fact: "expired",
        }],
      });
      assert.equal(rejected.error, "INVALID_INPUT");
      assert.equal(await countTable(db, "entity_review", brandId), 0);
      const extras = Array.from({ length: 8 }, () => ({ observationId: randomUUID(), analysisVersionId: randomUUID() }));
      const saved = await recordEntityReviews(db, owner, {
        brandId,
        method,
        population: 50,
        marks: [
          {
            observationId: seeded.conflict.observationId,
            analysisVersionId: seeded.conflict.analysisId,
            reviewed: true,
            confirmed: true,
            fact: conflict.reviewFact,
          },
          {
            observationId: randomUUID(),
            analysisVersionId: randomUUID(),
            reviewed: true,
            confirmed: true,
            fact: "active",
          },
          ...extras.map((item) => ({ ...item, reviewed: true, confirmed: false, fact: "active" })),
        ],
      });
      assert.equal(saved.board.errorLabel, "2/10");
      assert.equal(saved.board.coverage, "10/50");
      assert.equal(saved.board.populationRate, null);
      assert.equal(JSON.stringify(saved.board).includes("%"), false);
      assert.equal(JSON.stringify(saved.board).includes("0.04"), false);
      const refreshed = await readEntityReviewWorkspace(db, owner, brandId);
      assert.equal(refreshed.board.errorLabel, "2/10");
      assert.equal(refreshed.board.coverage, "10/50");
      assert.equal(refreshed.board.populationRate, null);
      assert.equal(refreshed.claims.find((claim) => claim.observationId === seeded.conflict.observationId).judgment, "conflict");
      const built = brandFactObservationQuery(owner, brandId, [seeded.conflict.questionId]);
      assert.match(built.sql, /o\.owner_id = \? AND o\.brand_id = \?/);
    } finally {
      await Promise.all([fixture.cleanup(), ddl.cleanup()]);
    }
  });
}
