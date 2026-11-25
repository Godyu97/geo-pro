import assert from "node:assert/strict";
import { test } from "node:test";
import { readSnapshotBusiness } from "../../src/features/reports/business-feedback.ts";
import {
  conclusionSentence,
  executionSentence,
  readExecution,
  readMetricConclusions,
  readVisits,
  visitSentences,
} from "../../src/features/reports/reading.ts";
import { buildSnapshotDocument, renderSnapshotHtml } from "../../src/features/reports/snapshot.ts";

const feedback = {
  deduped_inquiries: 1,
  primary_distribution: { referral: 0, self_report: 1, landing_page: 0, unknown: 0 },
  qualified_inquiries: 1,
  ai_referral_conversion: {
    identified_referrals: 0,
    session_denominator: null,
    rate: null,
    reason: "missing_session_denominator",
  },
  self_reported_inquiries: 1,
  self_reported_over_visits: null,
  crawler_visits: { count: 1, called_included: false },
  answer_citations: 0,
  causality: "not_established",
};

function query(queryId, beforeRate, afterRate) {
  return {
    queryId,
    queryVersion: "v1",
    before: { numerator: beforeRate, denominator: 1, rate: beforeRate, observationIds: [`${queryId}-before`] },
    after: { numerator: afterRate, denominator: 1, rate: afterRate, observationIds: [`${queryId}-after`] },
    sourceMissing: false,
  };
}

function comparison(conclusion, common, before, after, delta, queries) {
  return {
    result: {
      grade: "exploratory",
      conclusion,
      commonQueryCount: common,
      frozenQueryCount: 4,
      before,
      after,
      deltaPp: delta,
      included: queries,
      excluded: [],
      sourceMissing: false,
      causality: "not_established",
    },
    excludedSamples: { before: [], after: [] },
    unavailable: { before: 0, after: 0 },
  };
}

function documentFor(locale) {
  return buildSnapshotDocument({
    reportId: "report-reading",
    brandId: "brand-reading",
    brandName: "阅读品牌",
    entityVersion: 1,
    timezone: "Asia/Shanghai",
    locale,
    intent: "business_loop",
    loopCompleted: true,
    metrics: {
      comparisons: {
        mention_rate: comparison("inconclusive", 3, 0.2, 0.5, 30, [query("mention", 0.2, 0.5)]),
        recommendation_rate: comparison("improved", 4, 0.2, 0.3, 10, [query("recommendation", 0.2, 0.3)]),
        official_site_citation_rate: comparison("declined", 3, 0.4, 0.2, -20, [query("citation", 0.4, 0.2)]),
      },
      evidence: {},
    },
    windows: {
      before: { start: "2026-11-01T00:00:00.000Z", endExclusive: "2026-11-08T00:00:00.000Z" },
      after: { start: "2026-11-09T00:00:00.000Z", endExclusive: "2026-11-16T00:00:00.000Z" },
    },
    publication: {
      id: "pub-reading",
      effectiveAt: "2026-11-18T07:00:00.000Z",
      verification: "verified",
    },
    createdAt: "2026-11-20T00:00:00.000Z",
    cost: { status: "not_applicable", reason: "no_sampling_cost" },
    labor: { status: "not_applicable", reason: "unrecorded" },
    businessFeedback: feedback,
  });
}

function section(html, id) {
  const start = html.indexOf(`<section id="${id}">`);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
}

test("saved conclusions stay on their own metrics and the four layers stay apart", () => {
  const document = documentFor("zh-CN");
  const saved = JSON.parse(JSON.stringify(document));
  assert.equal(saved.comparisons.mention_rate.common_query_count, 3);
  assert.equal(saved.comparisons.mention_rate.conclusion, "inconclusive");
  assert.equal(saved.comparisons.mention_rate.delta_pp, 30);
  assert.equal(saved.comparisons.recommendation_rate.common_query_count, 4);
  assert.equal(saved.comparisons.recommendation_rate.conclusion, "improved");
  assert.equal(saved.comparisons.recommendation_rate.delta_pp, 10);
  assert.equal(saved.comparisons.official_site_citation_rate.common_query_count, 3);
  assert.equal(saved.comparisons.official_site_citation_rate.conclusion, "declined");
  assert.equal(saved.comparisons.official_site_citation_rate.delta_pp, -20);
  assert.equal(JSON.stringify(saved).includes("观察改善"), false);
  assert.equal(JSON.stringify(saved).includes("无效果"), false);

  assert.deepEqual(readMetricConclusions(saved), {
    mention_rate: "inconclusive",
    recommendation_rate: "improved",
    official_site_citation_rate: "declined",
  });
  assert.deepEqual(readExecution(saved), { state: "verified", effectiveAt: "2026-11-18T07:00:00.000Z" });
  assert.deepEqual(readVisits(saved), { state: "ready", count: 1, citations: 0 });

  const zh = renderSnapshotHtml(document);
  assert.equal(JSON.stringify(document), JSON.stringify(saved));
  const mention = section(zh, "mention_rate");
  const recommendation = section(zh, "recommendation_rate");
  const citation = section(zh, "official_site_citation_rate");
  assert.match(mention, /无法判断。不建立因果。/);
  assert.match(mention, /\+30\.0pp/);
  assert.equal(mention.includes("观察改善"), false);
  assert.equal(mention.includes("无效果"), false);
  assert.match(recommendation, /观察改善。不建立因果。/);
  assert.match(recommendation, /共同题 4\/4/);
  assert.match(recommendation, /\+10\.0pp/);
  assert.match(citation, /观察下降。不建立因果。/);
  assert.match(citation, /-20\.0pp/);
  assert.equal(zh.includes("无效果"), false);
  assert.equal(zh.includes("没有效果"), false);

  const execution = section(zh, "execution");
  const visits = section(zh, "crawler-visits");
  const inquiries = section(zh, "business-feedback");
  assert.match(execution, /已核验发布，生效时间 2026-11-18T07:00:00\.000Z/);
  assert.match(execution, /不是可见性结论/);
  assert.equal(execution.includes("观察改善"), false);
  assert.match(visits, /爬虫访问观察 1/);
  assert.match(visits, /called_included: false/);
  assert.equal(visits.includes("已被 AI 收录"), false);
  assert.equal(visits.includes("去重咨询"), false);
  assert.match(inquiries, /去重咨询 1/);
  assert.match(inquiries, /可识别引荐转化率 N\/A。没有可靠会话分母/);
  assert.equal(inquiries.includes("爬虫访问"), false);

  const en = renderSnapshotHtml(documentFor("en"));
  assert.match(section(en, "mention_rate"), /Inconclusive\. This does not establish causality\./);
  assert.match(section(en, "recommendation_rate"), /Observed improvement\. This does not establish causality\./);
  assert.match(section(en, "recommendation_rate"), /\+10\.0pp/);
  assert.match(section(en, "official_site_citation_rate"), /Observed decline\. This does not establish causality\./);
  assert.match(section(en, "execution"), /Effective time 2026-11-18T07:00:00\.000Z/);
  assert.match(section(en, "crawler-visits"), /Crawler visit observations 1/);
  assert.match(section(en, "business-feedback"), /Identified-referral conversion N\/A/);
  assert.equal(en.includes("no effect"), false);
  assert.equal(en.includes("无效果"), false);
});

test("a cleared historical snapshot is not relabeled as observed improvement", () => {
  const historical = {
    schema_version: "report-v3",
    metric: "recommendation_rate",
    summary: { common_query_count: 3, delta_pp: 10 },
    source_missing: true,
  };
  const before = JSON.stringify(historical);
  assert.deepEqual(readMetricConclusions(historical), {});
  assert.equal(readExecution(historical).state, "absent");
  assert.equal(readVisits(historical).state, "absent");
  assert.equal(readSnapshotBusiness(historical).state, "absent");
  assert.equal(JSON.stringify(historical), before);

  const zh = [
    executionSentence("zh-CN", readExecution(historical)),
    ...visitSentences("zh-CN", readVisits(historical)),
    conclusionSentence("zh-CN", "unchanged"),
    conclusionSentence("zh-CN", "incomparable"),
  ].join("\n");
  const en = [
    executionSentence("en", readExecution(historical)),
    ...visitSentences("en", readVisits(historical)),
    conclusionSentence("en", "inconclusive"),
  ].join("\n");
  assert.match(zh, /执行成果缺失/);
  assert.match(zh, /没有保存爬虫访问/);
  assert.match(zh, /无变化。不建立因果。/);
  assert.match(zh, /不可比较。不建立因果。/);
  assert.equal(zh.includes("观察改善"), false);
  assert.equal(zh.includes("爬虫访问观察 0"), false);
  assert.equal(zh.includes("去重咨询 0"), false);
  assert.match(en, /The execution record is missing/);
  assert.match(en, /no saved crawler visits/);
  assert.match(en, /Inconclusive\. This does not establish causality\./);
  assert.equal(en.includes("Observed improvement"), false);
  assert.equal(en.includes("no effect"), false);
  assert.equal(en.includes("Crawler visit observations 0"), false);

  const missingConclusion = {
    comparisons: {
      mention_rate: { common_query_count: 3, delta_pp: 10 },
      recommendation_rate: { conclusion: "no_effect", delta_pp: 10 },
    },
  };
  assert.equal(readMetricConclusions(missingConclusion).mention_rate, "missing");
  assert.equal(readMetricConclusions(missingConclusion).recommendation_rate, "missing");
  assert.equal(conclusionSentence("zh-CN", "missing").includes("观察改善"), false);
  assert.equal(conclusionSentence("en", "missing").includes("Observed improvement"), false);
});
