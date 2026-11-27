import { createHash, randomUUID } from "node:crypto";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";

const time = "2026-11-26T08:00:00.000Z";
const later = "2026-11-26T09:00:00.000Z";

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
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

export async function seedBrandFactClaims(db, ownerId, brandId, { extraSamples = 0, groupId } = {}) {
  const brands = new BrandDao(db);
  await brands.insertBrand(ownerId, brandId, time, groupId);
  await brands.insertVersion(brandId, 1, { ...initialBrandFields, name: "核验主张夹具" }, time);
  const conflictQuestionId = randomUUID();
  const expiredQuestionId = randomUUID();
  const discoveryQuestionId = randomUUID();
  const extraQuestions = Array.from({ length: extraSamples }, (_, index) => ({
    id: randomUUID(), text: `官方售价核对问题 ${index + 1}`, type: "brand_fact",
  }));
  const setId = randomUUID();
  await queryWithParameters(db, `INSERT INTO prompt_set
      (brand_id, id, set_id, version, entity_version, region, language, content, created_at)
    VALUES (?, ?, ?, 1, 1, 'CN', 'zh-CN', ?, ?)`, [
    brandId, setId, setId, promptContent([
      { id: conflictQuestionId, text: "这个品牌现在的官方售价是多少", type: "brand_fact" },
      { id: expiredQuestionId, text: "这个品牌去年的促销价是多少", type: "brand_fact" },
      { id: discoveryQuestionId, text: "这个品类里大家一般怎么选", type: "discovery" },
      ...extraQuestions,
    ]), time,
  ]);
  const runId = randomUUID();
  const channelId = randomUUID();
  await queryWithParameters(db, `INSERT INTO monitoring_run (
      id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
      repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
      requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
      status, sampling_complete, created_at
    ) VALUES (?, ?, ?, ?, ?, 'consumer_ui', ?, 1, 1, ?, 1, 1, ?, 'CN', 'zh-CN', 'unknown', NULL, NULL, NULL, 0, 'queued', 0, ?)`, [
    runId, brandId, ownerId, randomUUID(), sha(runId), setId, 3 + extraSamples, 3 + extraSamples, time,
  ]);
  const rows = [
    { questionId: conflictQuestionId, question: "这个品牌现在的官方售价是多少", answer: "该品牌官方售价为 299 元", at: later },
    { questionId: expiredQuestionId, question: "这个品牌去年的促销价是多少", answer: "去年促销价 99 元", at: time },
    { questionId: discoveryQuestionId, question: "这个品类里大家一般怎么选", answer: "自然发现题不应进入核验主张", at: later },
    ...extraQuestions.map((question) => ({
      questionId: question.id,
      question: question.text,
      answer: "该品牌官方售价为 299 元",
      at: later,
    })),
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
  return { approvedId, expiredId, conflict, expired, discovery: rows[2], extras: rows.slice(3) };
}
