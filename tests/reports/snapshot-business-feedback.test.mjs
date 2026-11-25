import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { importBusinessLeads } from "../../src/features/business-feedback/commands.ts";
import {
  freezeLeadValidityRule,
  qualifyLeadAgainstRule,
  recordLeadObservation,
  saveLeadValidityRule,
} from "../../src/features/business-feedback/quality-commands.ts";
import { businessLeadPrimaryCountsQuery } from "../../src/features/business-feedback/dao.ts";
import { leadObservationRollupQuery } from "../../src/features/business-feedback/quality-dao.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { registerCrawlerVisit } from "../../src/features/data-connections/crawler-commands.ts";
import { crawlerBrandRollupQuery } from "../../src/features/data-connections/crawler-dao.ts";
import { readSnapshotBusiness, summarizeBusinessFeedback } from "../../src/features/reports/business-feedback.ts";
import { generateReport, readSnapshot, requestRetest } from "../../src/features/reports/commands.ts";
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

function memoryStorage() {
  const objects = new Map();
  return {
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

function sample(numerator = 0) {
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
    numerator,
    denominator: 1,
  };
}

const range = {
  before: { start: "2026-11-01T00:00:00.000Z", endExclusive: "2026-11-02T00:00:00.000Z", samples: [sample()] },
  after: { start: "2026-11-10T00:00:00.000Z", endExclusive: "2026-11-11T00:00:00.000Z", samples: [sample(1)] },
};

test("missing session denominator stays N/A and crawler visits are not inclusion", () => {
  const historical = {
    schema_version: "report-v4",
    cost: { status: "not_applicable", reason: "no_sampling_cost" },
    labor: { status: "not_applicable", reason: "unrecorded" },
  };
  assert.deepEqual(readSnapshotBusiness(historical), { state: "absent" });
  assert.equal(readSnapshotBusiness({ ...historical, business_feedback: { called_included: true } }).state, "unavailable");

  const empty = summarizeBusinessFeedback({
    primaryCounts: { referral: 0, self_report: 1, landing_page: 0, unknown: 0 },
    qualified: 0,
    identifiedReferrals: 9,
    sessionDenominator: null,
    observationCrawlerVisits: 0,
    observationAnswerCitations: 0,
    crawlerVisitCount: 4,
    crawlerAnswerCitations: 0,
  });
  assert.equal(empty.deduped_inquiries, 1);
  assert.equal(empty.self_reported_inquiries, 1);
  assert.equal(empty.self_reported_over_visits, null);
  assert.equal(empty.ai_referral_conversion.rate, null);
  assert.equal(empty.ai_referral_conversion.reason, "missing_session_denominator");
  assert.deepEqual(empty.crawler_visits, { count: 4, called_included: false });
  assert.equal(empty.answer_citations, 0);
  assert.equal(JSON.stringify(empty).includes("9/4"), false);

  const measured = summarizeBusinessFeedback({
    primaryCounts: { referral: 1, self_report: 0, landing_page: 0, unknown: 0 },
    qualified: 1,
    identifiedReferrals: 4,
    sessionDenominator: 10,
    observationCrawlerVisits: 7,
    observationAnswerCitations: 2,
    crawlerVisitCount: 1,
    crawlerAnswerCitations: 3,
  });
  assert.equal(measured.ai_referral_conversion.rate, 0.4);
  assert.equal(measured.ai_referral_conversion.reason, null);
  assert.equal(measured.crawler_visits.count, 8);
  assert.equal(measured.crawler_visits.called_included, false);
  assert.equal(measured.answer_citations, 5);
  assert.equal(measured.self_reported_over_visits, null);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: snapshot business layer keeps self-report and crawler visits apart`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const owner = await account(db);
    const outsider = await account(db);
    const brands = new BrandDao(db);
    const brandId = randomUUID();
    const otherBrand = randomUUID();
    await brands.insertBrand(owner, brandId, time);
    await brands.insertVersion(brandId, 1, {
      name: "反馈品牌",
      description: "Synthetic brand for business feedback snapshots",
      website: "https://feedback.example.com",
      aliases: [],
      region: "CN",
      language: "zh-CN",
      competitors: [],
      questions: [],
    }, time);
    await brands.insertBrand(outsider, otherBrand, time);
    const storage = memoryStorage();
    const options = { env: storageEnv, storage, now: new Date(time) };

    const imported = await importBusinessLeads(db, owner, {
      brandId,
      rows: [
        { eventId: "evt-self", evidence: "self_report", directIdentifier: false },
        { eventId: "13800138000", evidence: "unknown", directIdentifier: false },
      ],
    }, clock);
    assert.equal(imported.leads.length, 1);
    assert.equal(imported.leads[0].primary, "self_report");
    assert.equal(JSON.stringify(imported).includes("13800138000"), false);
    await importBusinessLeads(db, outsider, {
      brandId: otherBrand,
      rows: [{ eventId: "evt-other", evidence: "referral", directIdentifier: false }],
    }, clock);
    const savedRule = await saveLeadValidityRule(db, owner, {
      brandId,
      requiresRealNeed: true,
      requiresIndustry: true,
      requiresFollowUp: true,
    }, clock);
    assert.equal(savedRule.error, undefined);
    const frozen = await freezeLeadValidityRule(db, owner, savedRule.rule.id);
    assert.equal(frozen.rule.frozen, true);
    const qualified = await qualifyLeadAgainstRule(db, owner, {
      brandId,
      ruleId: frozen.rule.id,
      realNeed: true,
      targetIndustry: true,
      followUp: true,
    }, clock);
    assert.equal(qualified.qualification.status, "qualified");
    const visit = await registerCrawlerVisit(db, owner, {
      brandId,
      userAgentClaimsAi: true,
      identityVerified: false,
      answerCitations: 0,
    }, clock);
    assert.equal(visit.error, undefined);
    assert.equal(visit.observation.calledIncluded, false);
    assert.equal(visit.observation.citations, 0);

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
      locale: "zh-CN",
      metric: "recommendation_rate",
    }, clock);
    assert.equal(retest.error, undefined);
    const report = await generateReport(db, owner, {
      action: "generate-report",
      brandId,
      operationId: randomUUID(),
      retestId: retest.retest.id,
      before: range.before,
      after: range.after,
      locale: "zh-CN",
      metric: "recommendation_rate",
      brandName: "反馈品牌",
    }, clock, options);
    assert.equal(report.error, undefined);
    const opened = await readSnapshot(db, owner, report.snapshot.id, options);
    assert.equal(opened.error, undefined);
    const document = JSON.parse(opened.json);
    assert.equal(document.schema_version, "report-v4");
    assert.equal(document.business_feedback.deduped_inquiries, 1);
    assert.deepEqual(document.business_feedback.primary_distribution, {
      referral: 0, self_report: 1, landing_page: 0, unknown: 0,
    });
    assert.equal(document.business_feedback.qualified_inquiries, 1);
    assert.equal(document.business_feedback.ai_referral_conversion.rate, null);
    assert.equal(document.business_feedback.ai_referral_conversion.reason, "missing_session_denominator");
    assert.equal(document.business_feedback.self_reported_over_visits, null);
    assert.deepEqual(document.business_feedback.crawler_visits, { count: 1, called_included: false });
    assert.equal(document.business_feedback.answer_citations, 0);
    assert.equal(document.business_feedback.causality, "not_established");
    assert.equal(opened.json.includes("13800138000"), false);
    assert.equal(opened.json.includes("evt-other"), false);
    const sectionStart = opened.html.indexOf('<section id="business-feedback">');
    const sectionEnd = opened.html.indexOf("</section>", sectionStart);
    const section = opened.html.slice(sectionStart, sectionEnd);
    assert.match(section, /去重咨询 1/);
    assert.match(section, /有效咨询 1/);
    assert.match(section, /可识别引荐转化率 N\/A/);
    assert.match(section, /没有可靠会话分母/);
    assert.match(section, /爬虫访问观察 1/);
    assert.match(section, /called_included: false/);
    assert.match(section, /回答引用 0/);
    assert.equal(section.includes("已被 AI 收录"), false);
    assert.equal(section.includes("因果增量"), true);
    const preserved = opened.json;

    const observed = await recordLeadObservation(db, owner, {
      brandId,
      identifiedReferrals: 4,
      sessionDenominator: 10,
      selfReported: 9,
      crawlerVisits: 0,
      answerCitations: 0,
    }, clock);
    assert.equal(observed.error, undefined);
    const second = await generateReport(db, owner, {
      action: "generate-report",
      brandId,
      operationId: randomUUID(),
      retestId: retest.retest.id,
      before: range.before,
      after: range.after,
      locale: "en",
      metric: "recommendation_rate",
      brandName: "反馈品牌",
    }, clock, options);
    assert.equal(second.error, undefined);
    const reread = await readSnapshot(db, owner, report.snapshot.id, options);
    assert.equal(reread.json, preserved);
    const next = JSON.parse((await readSnapshot(db, owner, second.snapshot.id, options)).json);
    assert.equal(next.business_feedback.ai_referral_conversion.rate, 0.4);
    assert.equal(next.business_feedback.self_reported_over_visits, null);
    assert.equal(next.business_feedback.crawler_visits.called_included, false);
    assert.match((await readSnapshot(db, owner, second.snapshot.id, options)).html, /Identified-referral conversion 40\.0%/);
    assert.equal(readSnapshotBusiness(JSON.parse(preserved)).state, "ready");
    const withoutLayer = JSON.parse(preserved);
    delete withoutLayer.business_feedback;
    assert.deepEqual(readSnapshotBusiness(withoutLayer), { state: "absent" });

    const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
    const plans = [];
    for (const query of [
      businessLeadPrimaryCountsQuery(owner, brandId),
      leadObservationRollupQuery(owner, brandId),
      crawlerBrandRollupQuery(owner, brandId),
    ]) {
      const run = async () => JSON.stringify(await queryWithParameters(db, explain + query.sql, query.values));
      const plan = db.kind === "postgresql"
        ? await db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, explain + query.sql, query.values));
        })
        : await run();
      plans.push(plan);
    }
    assert.match(plans[0], /business_lead_owner_idx|business_lead/);
    assert.match(plans[1], /lead_observation_owner_idx|lead_observation/);
    assert.match(plans[2], /crawler_observation_owner_idx|crawler_observation/);
    if (db.kind === "postgresql") {
      assert.doesNotMatch(plans[0], /Seq Scan on business_lead/);
      assert.doesNotMatch(plans[1], /Seq Scan on lead_observation/);
    }
    t.diagnostic(plans.join("\n"));
  });
}
