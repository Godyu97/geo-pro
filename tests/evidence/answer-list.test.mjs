import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  answerListFilterActive,
  answerListFiltersFromSearch,
  answerListPath,
  clusterForAnswer,
  clusterOptions,
  filterAnswerList,
} from "../../src/features/evidence/answer-list.ts";
import { readAnswerListContext } from "../../src/features/evidence/answer-list-context.ts";
import { answerListContextQuery } from "../../src/features/evidence/dao.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import { analysisRuleVersion } from "../../src/features/evidence/rules.ts";
import { overviewScopeFromSearch } from "../../src/features/evidence/overview-contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import { memoryCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const capturedAt = "2026-11-20T08:00:00.000Z";
const fields = {
  name: "乙品牌", description: "Synthetic brand for answer list filters", website: "https://yi.example.com",
  aliases: ["乙"], region: "CN", language: "zh-CN", competitors: [], questions: [],
};

function item(partial) {
  return {
    observationId: randomUUID(),
    questionText: "普通问题",
    answerText: "普通回答",
    clusterId: null,
    mentioned: "true",
    recommended: "true",
    officialSiteCited: "false",
    ...partial,
  };
}

function question(clusterId, text) {
  return {
    id: randomUUID(), clusterId, text, source: "manual", sourceNote: "", type: "discovery", stage: "consider",
    region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary: false,
  };
}

function cluster(id, audience, intent) {
  return { id, audience, intent, primaryPage: "", conversionAction: "" };
}

test("keyword, cluster and unknown filters keep false separate from unknown", () => {
  const installCluster = randomUUID();
  const budgetCluster = randomUUID();
  const install = item({ questionText: "如何安装这个设备", clusterId: installCluster, recommended: "true" });
  const maintain = item({ questionText: "日常维护怎么做", clusterId: installCluster, recommended: "false" });
  const budget = item({ questionText: "预算大概多少", clusterId: budgetCluster, recommended: "unknown" });
  const parts = item({
    questionText: "配件是否通用",
    answerText: "需要核对密封圈型号",
    clusterId: budgetCluster,
    mentioned: "unknown",
    recommended: "true",
    officialSiteCited: "unknown",
  });
  const rows = [install, maintain, budget, parts];

  assert.deepEqual(filterAnswerList(rows, { q: "安装" }).map((row) => row.observationId), [install.observationId]);
  assert.deepEqual(
    filterAnswerList(rows, { cluster: installCluster }).map((row) => row.observationId),
    [install.observationId, maintain.observationId],
  );
  assert.deepEqual(filterAnswerList(rows, { recommended: "unknown" }).map((row) => row.observationId), [budget.observationId]);
  assert.deepEqual(filterAnswerList(rows, { recommended: "false" }).map((row) => row.observationId), [maintain.observationId]);
  assert.deepEqual(filterAnswerList(rows, { mentioned: "unknown" }).map((row) => row.observationId), [parts.observationId]);
  assert.deepEqual(filterAnswerList(rows, { mentioned: "false" }), []);
  assert.deepEqual(filterAnswerList(rows, { officialSiteCited: "unknown" }).map((row) => row.observationId), [parts.observationId]);
  assert.deepEqual(filterAnswerList(rows, { q: "密封圈" }).map((row) => row.observationId), [parts.observationId]);
  assert.deepEqual(filterAnswerList(rows, { q: "INSTALL" }).map((row) => row.observationId), []);
  const english = item({ questionText: "How to install the unit", answerText: "Follow the guide." });
  assert.equal(filterAnswerList([english], { q: "install" })[0].observationId, english.observationId);
  assert.equal(answerListFiltersFromSearch({ recommended: "no" }).success, false);
  assert.equal(answerListFilterActive({}), false);
});

test("return query keeps list filters and the original scope", () => {
  const brandId = randomUUID();
  const clusterId = randomUUID();
  const scope = {
    brandId,
    sourceMode: "model_api",
    region: "CN",
    requestedNetworkMode: "off",
    from: "2026-11-20T00:00:00.000Z",
    to: "2026-11-20T23:59:59.999Z",
  };
  const filter = { q: "安装&维护", cluster: clusterId, mentioned: "true", recommended: "unknown", officialSiteCited: "false" };
  const href = answerListPath("/dashboard/monitoring/answers", scope, filter);
  const params = Object.fromEntries(new URL(href, "http://localhost").searchParams.entries());
  const parsedScope = overviewScopeFromSearch(params, { brandId, sourceMode: "consumer_ui" });
  const parsedFilter = answerListFiltersFromSearch(params);
  assert.equal(parsedScope.success, true);
  assert.equal(parsedFilter.success, true);
  assert.equal(parsedScope.data.sourceMode, "model_api");
  assert.equal(parsedScope.data.region, "CN");
  assert.equal(parsedScope.data.requestedNetworkMode, "off");
  assert.equal(parsedScope.data.from, scope.from);
  assert.equal(parsedScope.data.to, scope.to);
  assert.deepEqual(parsedFilter.data, filter);
  assert.equal("q" in parsedScope.data, false);

  const rows = [
    item({
      questionText: "如何安装&维护这个设备",
      clusterId,
      mentioned: "true",
      recommended: "unknown",
      officialSiteCited: "false",
    }),
    item({ questionText: "别的问题", clusterId: randomUUID(), recommended: "false" }),
  ];
  const first = filterAnswerList(rows, filter).map((row) => row.observationId);
  const second = filterAnswerList(rows, parsedFilter.data).map((row) => row.observationId);
  assert.deepEqual(second, first);
  assert.equal(first.length, 1);

  const linkedId = randomUUID();
  const latestId = randomUUID();
  const questionId = randomUUID();
  const linked = new Map([[ "set-a", {
    questions: [{ id: questionId, text: "如何安装这个设备", clusterId: linkedId }],
    clusters: [{ id: linkedId, audience: "安装用户", intent: "完成安装" }],
  }]]);
  const latest = {
    questions: [{ id: randomUUID(), text: "如何安装这个设备", clusterId: latestId }],
    clusters: [{ id: latestId, audience: "旧簇", intent: "旧意图" }],
  };
  assert.equal(clusterForAnswer({
    questionText: "如何安装这个设备", questionId, promptSetId: "set-a",
  }, linked, latest)?.id, linkedId);
  assert.equal(clusterForAnswer({
    questionText: "如何安装这个设备", questionId: null, promptSetId: null,
  }, linked, latest)?.id, latestId);
  assert.equal(clusterForAnswer({
    questionText: "如何安装这个设备", questionId, promptSetId: "missing",
  }, linked, latest), null);

  const options = clusterOptions(
    [{ id: clusterId, audience: "", intent: "" }],
    randomUUID(),
    (index) => `未命名 ${index}`,
  );
  assert.equal(options.length, 2);
  assert.equal(options[0].label, "未命名 1");
});

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "List owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true]);
  return id;
}

async function insertObservation(db, row) {
  await queryWithParameters(db, `INSERT INTO answer_observation (
    id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
    fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
    evidence_state, locator_ref, collector_id, missing_reason, created_at,
    target_region, observed_region, new_session, product_mode, network_trigger
  ) VALUES (?, ?, ?, NULL, NULL, 'model_api', 'official_api', ?, ?, ?, ?, 'CN', 'zh-CN', 'off', 1, 'complete', 'complete', NULL, NULL, NULL, ?, 'CN', 'CN', 'unknown', 'unknown', 'unknown')`, [
    row.id, row.brandId, row.ownerId, row.questionText, row.answerText, row.fingerprint, capturedAt, capturedAt,
  ]);
  await queryWithParameters(db, `INSERT INTO answer_analysis_version (
    id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
    official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
  ) VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, NULL, 'classified', NULL, NULL, NULL, ?)`, [
    randomUUID(), row.id, row.brandId, analysisRuleVersion, row.mentioned, row.recommended, row.officialSiteCited, capturedAt,
  ]);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: answer list filters stay inside the brand and do not change overview metrics`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const owner = await account(db);
    const outsider = await account(db);
    const brand = randomUUID();
    const otherBrand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, capturedAt);
    await brands.insertVersion(brand, 1, fields, capturedAt);
    await brands.insertBrand(outsider, otherBrand, capturedAt);
    await brands.insertVersion(otherBrand, 1, { ...fields, name: "另一品牌" }, capturedAt);

    const installCluster = randomUUID();
    const budgetCluster = randomUUID();
    const decoyCluster = randomUUID();
    const otherCluster = randomUUID();
    const content = {
      clusters: [cluster(installCluster, "安装用户", "完成安装"), cluster(budgetCluster, "预算用户", "比较价格")],
      questions: [
        { ...question(installCluster, "如何安装这个设备"), primary: true },
        question(installCluster, "日常维护怎么做"),
        question(budgetCluster, "预算大概多少"),
        question(budgetCluster, "配件是否通用"),
      ],
    };
    const prompts = new PromptDao(db, brand);
    await prompts.insertSet({
      id: randomUUID(), setId: randomUUID(), version: 1, entityVersion: 1, region: "CN", language: "zh-CN",
      content: {
        clusters: [cluster(decoyCluster, "旧簇", "旧意图")],
        questions: [{ ...question(decoyCluster, "如何安装这个设备"), primary: true }],
      },
      createdAt: "2026-11-19T08:00:00.000Z",
    });
    await prompts.insertSet({
      id: randomUUID(), setId: randomUUID(), version: 1, entityVersion: 1, region: "CN", language: "zh-CN",
      content, createdAt: capturedAt,
    });
    await new PromptDao(db, otherBrand).insertSet({
      id: randomUUID(), setId: randomUUID(), version: 1, entityVersion: 1, region: "CN", language: "zh-CN",
      content: {
        clusters: [cluster(otherCluster, "其他品牌", "相同题目")],
        questions: [{ ...question(otherCluster, "如何安装这个设备"), primary: true }],
      },
      createdAt: capturedAt,
    });

    const install = randomUUID();
    const maintain = randomUUID();
    const budget = randomUUID();
    const parts = randomUUID();
    const foreign = randomUUID();
    const rows = [
      { id: install, questionText: "如何安装这个设备", answerText: "按说明书固定", mentioned: "true", recommended: "true", officialSiteCited: "false" },
      { id: maintain, questionText: "日常维护怎么做", answerText: "定期清洁", mentioned: "true", recommended: "false", officialSiteCited: "true" },
      { id: budget, questionText: "预算大概多少", answerText: "暂无明确报价", mentioned: "true", recommended: "unknown", officialSiteCited: "false" },
      { id: parts, questionText: "配件是否通用", answerText: "需要核对密封圈型号", mentioned: "unknown", recommended: "true", officialSiteCited: "unknown" },
    ];
    for (const row of rows) {
      await insertObservation(db, {
        ...row, brandId: brand, ownerId: owner, fingerprint: sha(row.id),
      });
    }
    await insertObservation(db, {
      id: foreign, brandId: otherBrand, ownerId: outsider, questionText: "如何安装这个设备", answerText: "另一品牌也写了密封圈",
      mentioned: "true", recommended: "true", officialSiteCited: "false",
      fingerprint: sha(foreign),
    });

    const overview = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "model_api" }, memoryCache());
    assert.equal("error" in overview, false);
    assert.equal(overview.sampleCount, 4);
    assert.deepEqual(overview.answers.map((answer) => answer.observationId).sort(), [install, maintain, budget, parts].sort());

    const context = await readAnswerListContext(db, owner, brand, [...overview.answers.map((answer) => answer.observationId), foreign]);
    assert.equal(context.rows.has(foreign), false);
    const detailed = overview.answers.map((answer) => {
      const row = context.rows.get(answer.observationId);
      const found = answer.questionText === "如何安装这个设备" || answer.questionText === "日常维护怎么做"
        ? installCluster
        : budgetCluster;
      assert.equal(row?.promptSetId ?? null, null);
      const clusterId = context.latest?.questions.find((question) => question.text === answer.questionText)?.clusterId;
      assert.equal(clusterId, found);
      return {
        ...answer,
        answerText: row.answerText,
        clusterId,
        mentioned: answer.mentioned,
        recommended: answer.recommended,
        officialSiteCited: answer.officialSiteCited,
      };
    });
    assert.deepEqual(filterAnswerList(detailed, { q: "安装" }).map((row) => row.observationId), [install]);
    assert.deepEqual(filterAnswerList(detailed, { cluster: installCluster }).map((row) => row.observationId).sort(), [install, maintain].sort());
    assert.deepEqual(filterAnswerList(detailed, { recommended: "unknown" }).map((row) => row.observationId), [budget]);
    assert.equal(filterAnswerList(detailed, { recommended: "false" }).some((row) => row.observationId === budget), false);
    assert.deepEqual(filterAnswerList(detailed, { q: "密封圈" }).map((row) => row.observationId), [parts]);
    assert.equal(overview.sampleCount, 4);
    assert.equal(overview.answers.length, 4);

    const built = answerListContextQuery(owner, brand, [install]);
    assert.match(built.sql, /o\.owner_id = \?/);
    assert.match(built.sql, /o\.brand_id = \?/);
    const explainPrefix = kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
    const plan = await queryWithParameters(db, `${explainPrefix}${built.sql}`, built.values);
    console.log(`${kind} answer-list context ${built.values.length} params`);
    console.log(plan.map((row) => JSON.stringify(row)).join("\n"));
    assert.ok(JSON.stringify(plan).length > 20);
  });
}
