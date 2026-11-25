import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { memoryCache } from "../../src/lib/cache/store.ts";
import { serializeOfficialReceipt } from "../../src/lib/ai/official-sampling.ts";
import { recordCapability } from "../../src/features/capabilities/commands.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  appendReferenceLink,
  ingestAdoptedObservation,
  readObservation,
  reviseAnalysis,
  submitManualEvidence,
} from "../../src/features/evidence/commands.ts";
import { scopedObservationQuery } from "../../src/features/evidence/dao.ts";
import { officialAttemptCapture } from "../../src/features/evidence/rules.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import { changeMaintenanceGrant } from "../../src/features/maintenance/core.ts";
import { acceptMonitoringRun, previewMonitoringRun } from "../../src/features/monitoring/commands.ts";
import { executeMonitoringRun } from "../../src/features/monitoring/execution.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import { updateQuota } from "../../src/features/quotas/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T14:30:00.000Z";
const clock = () => time;
const secret = "official-ingest-secret-official-ingest";
const fields = {
  name: "乙品牌", description: "Synthetic brand without a website", website: "",
  aliases: ["乙"], region: "CN", language: "zh-CN", competitors: [], questions: [],
};

test("official receipt capture keeps an empty set, a missing set, and unknown network apart", () => {
  const empty = officialAttemptCapture(serializeOfficialReceipt({
    responseId: "resp-empty", modelVersion: "fixture", networkTrigger: "not_triggered",
    citationSetState: "complete", citations: [],
  }));
  assert.equal(empty.citationSetState, "complete");
  assert.equal(empty.citations.length, 0);
  assert.equal(empty.networkTrigger, "not_triggered");
  const missing = officialAttemptCapture(null);
  assert.equal(missing.citationSetState, "missing");
  assert.equal(missing.networkTrigger, "unknown");
  assert.equal(officialAttemptCapture("{").citationSetState, "missing");
});

function capability(actorId, overrides = {}) {
  return {
    action: "record", actorId, operationId: randomUUID(), expectedVersion: null, channelId: null,
    vendorId: "acme-ai", kind: "model_api", reason: "initial-record", status: "candidate",
    displayName: "Acme API", productEntry: "chat.completions", mode: "official-api", modelVersion: "unknown",
    availability: "synthetic fixture", searchRequired: 0, citationCapability: "complete",
    regionTarget: "CN", regionActual: "unknown", limitsSummary: "No production traffic",
    sopSummary: "Human SOP without secrets",     verifiedAt: null, expiresAt: null, publicVisible: 0,
    ...overrides,
  };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Evidence owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true]);
  return id;
}

function receipt(partial) {
  const text = serializeOfficialReceipt({
    responseId: partial.responseId,
    modelVersion: "fixture-model",
    networkTrigger: partial.networkTrigger,
    citationSetState: partial.citationSetState,
    citations: partial.citations,
    searchResults: partial.searchResults,
  });
  assert.ok(text);
  return text;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: adopted official receipts ingest once and stay out of the wrong denominators`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const cache = memoryCache();
    const [owner, operator, outsider] = await Promise.all([account(db), account(db), account(db)]);
    const brand = randomUUID();
    const otherBrand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);
    await brands.insertBrand(outsider, otherBrand, time);

    for (const permission of ["capabilities.manage", "quotas.manage"]) {
      assert.equal((await changeMaintenanceGrant(db, {
        action: "grant", operatorId: operator, userId: operator, permission, reason: "initial-setup",
      })).status, "allowed");
    }
    const api = (await recordCapability(db, operator, capability(operator), clock)).data.after;
    const verified = (await recordCapability(db, operator, capability(operator, {
      expectedVersion: 1, channelId: api.channelId, reason: "verification", status: "verified", verifiedAt: time, publicVisible: 0,
    }), clock)).data.after;
    assert.equal((await updateQuota(db, operator, {
      action: "set", actorId: operator, brandId: brand, kind: "sampling", operationId: randomUUID(),
      expectedVersion: null, reason: "pilot-approval", countLimit: 20, budgetMinor: 5000, currency: "CNY",
      expiresAt: "2026-12-23T06:00:00.000Z",
    }, clock)).status, "allowed");

    const clusterId = randomUUID();
    const specs = [
      ["complete", "公开资料不足时怎样判断一轮监测还能开始"],
      ["empty", "日常复盘时怎样核对引用是否来自公开页面"],
      ["missing", "预算有限时怎样判断一轮监测是否足够"],
      ["unsupported", "条件缺失时怎样避免把未知写成零"],
      ["synthetic", "演示样本不应进入自然分母"],
      ["unknown-cost", "费用未核对时怎样保留待核对"],
    ];
    const questions = specs.map(([, text]) => ({
      id: randomUUID(), clusterId, text, source: "manual", sourceNote: "", type: "discovery", stage: "awareness",
      region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary: true,
    }));
    const byKey = new Map(specs.map(([key], index) => [key, questions[index]]));
    const content = {
      clusters: [{ id: clusterId, audience: "购买者", intent: "比较使用条件", primaryPage: "", conversionAction: "" }],
      questions,
    };
    const setId = randomUUID();
    await new PromptDao(db, brand).insertSet({
      id: setId, setId, version: 1, entityVersion: 1, region: "CN", language: "zh-CN", createdAt: time,
      content,
    });
    const preview = await previewMonitoringRun(db, owner, {
      action: "preview", brandId: brand, track: "model_api", promptSetId: setId, repeats: 1,
      requestedNetworkMode: "unknown", channelIds: [verified.channelId], ceiling: { currency: "CNY", upperMinor: 10 },
    }, secret, clock);
    assert.equal(preview.error, undefined, preview.error);
    const accepted = await acceptMonitoringRun(db, owner, {
      action: "accept", ...preview.snapshot, token: preview.token, operationId: randomUUID(),
    }, secret, clock);
    assert.equal(accepted.error, undefined, accepted.error);
    const unknownId = byKey.get("unknown-cost").id;
    const executed = await executeMonitoringRun(db, owner, accepted.id, {
      label: "isolated",
      sample(input) {
        if (input.questionId === unknownId) return Promise.resolve({ disposition: "unknown", rawText: "费用仍待核对", synthetic: true });
        return Promise.resolve({
          disposition: "adopted",
          rawText: input.questionId === byKey.get("empty").id
            ? "正文里的 https://body.example/only-in-text 不是引用。"
            : "甲可考虑；乙不适合本需求。",
          actualMinor: 3,
          synthetic: true,
        });
      },
    }, clock);
    assert.equal(executed.error, undefined, executed.error);

    const slotByQuestion = new Map(executed.slots.map((slot) => [slot.questionId, slot]));
    const officialCases = {
      complete: receipt({
        responseId: "resp-complete", networkTrigger: "triggered", citationSetState: "complete",
        citations: [{ url: "https://public.example/guide", title: "公开说明", position: 1 }],
      }),
      empty: receipt({
        responseId: "resp-empty", networkTrigger: "not_triggered", citationSetState: "complete", citations: [],
        searchResults: [{ url: "https://yi.example.com/guide?utm_source=search", title: "搜索候选", position: 1 }],
      }),
      missing: receipt({
        responseId: "resp-missing", networkTrigger: "unknown", citationSetState: "missing", citations: [],
      }),
      unsupported: receipt({
        responseId: "resp-unsupported", networkTrigger: "unknown", citationSetState: "unsupported", citations: [],
      }),
    };
    for (const [key, body] of Object.entries(officialCases)) {
      const slot = slotByQuestion.get(byKey.get(key).id);
      assert.equal(slot.status, "succeeded");
      await queryWithParameters(db,
        `UPDATE monitoring_attempt SET transport = 'official_api', synthetic = 0, receipt = ? WHERE id = ?`,
        [body, slot.adoptedAttemptId]);
    }
    const unknownSlot = slotByQuestion.get(unknownId);
    assert.equal(unknownSlot.status, "reconciliation_required");
    const [unknownAttempt] = await queryWithParameters(db,
      `SELECT actual_minor AS "actualMinor", cost_state AS "costState" FROM monitoring_attempt WHERE slot_id = ?`,
      [unknownSlot.id]);
    assert.equal(unknownAttempt.actualMinor, null);
    assert.equal(unknownAttempt.costState, "unknown");

    function ingestInput(slotId, operationId = randomUUID()) {
      return {
        action: "ingest-adopted",
        brandId: brand,
        slotId,
        operationId,
        brandName: "乙品牌",
        aliases: ["乙"],
        officialWebsite: null,
        citationSetState: "complete",
        observedRegion: "US",
        citations: [{ rawUrl: "https://caller.example/not-from-receipt", citationOrigin: "provider_native" }],
      };
    }

    const saved = new Map();
    for (const key of ["complete", "empty", "missing", "unsupported", "synthetic"]) {
      const slot = slotByQuestion.get(byKey.get(key).id);
      const ingested = await ingestAdoptedObservation(db, owner, {
        ...ingestInput(slot.id),
        officialWebsite: key === "empty" ? "https://yi.example.com" : null,
      }, clock, cache);
      assert.equal(ingested.error, undefined, ingested.error);
      saved.set(key, ingested);
    }
    const rejectedCost = await ingestAdoptedObservation(db, owner, ingestInput(unknownSlot.id), clock, cache);
    assert.equal(rejectedCost.error, "NOT_FOUND");
    const wrongBrand = await ingestAdoptedObservation(db, owner, {
      ...ingestInput(slotByQuestion.get(byKey.get("complete").id).id),
      brandId: otherBrand,
    }, clock, cache);
    assert.equal(wrongBrand.error, "NOT_FOUND");
    const missingSlot = await ingestAdoptedObservation(db, owner, ingestInput(randomUUID()), clock, cache);
    assert.equal(missingSlot.error, "NOT_FOUND");

    const complete = saved.get("complete");
    assert.equal(complete.observation.requestedNetworkMode, "unknown");
    assert.equal(complete.observation.networkTrigger, "triggered");
    assert.equal(complete.observation.targetRegion, "CN");
    assert.equal(complete.observation.observedRegion, "unknown");
    assert.equal(complete.observation.newSession, "unknown");
    assert.equal(complete.observation.productMode, "unknown");
    assert.equal(complete.citationPool.inC, true);
    assert.equal(complete.citationPool.cited, true);
    assert.equal(complete.citations.length, 1);
    assert.equal(complete.citations[0].citationOrigin, "provider_native");
    assert.equal(complete.citations[0].normalizedUrl, "https://public.example/guide");
    assert.equal(complete.citations.some((item) => item.rawUrl.includes("caller.example")), false);
    const completeRead = await readObservation(db, owner, complete.observation.id);
    assert.equal(completeRead.capture.costState, "known");
    assert.equal(completeRead.capture.actualMinor, 3);
    assert.equal(completeRead.capture.currency, "CNY");

    const empty = saved.get("empty");
    assert.equal(empty.observation.networkTrigger, "not_triggered");
    assert.equal(empty.observation.citationSetState, "complete");
    assert.equal(empty.citationPool.inC, true);
    assert.equal(empty.citationPool.cited, false);
    assert.equal(empty.citations.some((item) => item.citationOrigin === "provider_native" || item.rawUrl.includes("body.example")), false);
    assert.equal(empty.citations.length, 1);
    assert.equal(empty.citations[0].citationOrigin, "search_candidate");
    assert.equal(empty.citations[0].normalizedUrl, "https://yi.example.com/guide");
    assert.equal(empty.latestAnalysis.officialSiteCited, "false");
    assert.equal(empty.observation.answerText.includes("https://body.example/only-in-text"), true);
    const appended = await appendReferenceLink(db, owner, {
      action: "append-reference",
      brandId: brand,
      observationId: empty.observation.id,
      operationId: randomUUID(),
      rawUrl: "https://analyst.example/page",
      citationOrigin: "analyst_found",
    }, clock, cache);
    assert.equal(appended.error, undefined, appended.error);
    assert.equal(appended.observation.answerText, empty.observation.answerText);
    assert.equal(appended.observation.fingerprint, empty.observation.fingerprint);
    assert.equal(appended.observation.citationSetState, "complete");
    assert.equal(appended.latestAnalysis.officialSiteCited, "false");
    assert.equal(appended.citationPool.cited, false);
    assert.equal(appended.citations.filter((item) => item.citationOrigin === "provider_native").length, 0);
    assert.equal(appended.citations.filter((item) => item.citationOrigin === "search_candidate").length, 1);
    assert.equal(appended.citations.filter((item) => item.citationOrigin === "analyst_found").length, 1);
    const outsiderAppend = await appendReferenceLink(db, outsider, {
      action: "append-reference",
      brandId: brand,
      observationId: empty.observation.id,
      operationId: randomUUID(),
      rawUrl: "https://outsider.example/hidden",
      citationOrigin: "search_candidate",
    }, clock, cache);
    assert.equal(outsiderAppend.error, "NOT_FOUND");
    assert.equal(await readObservation(db, outsider, empty.observation.id), null);

    const missing = saved.get("missing");
    assert.equal(missing.observation.networkTrigger, "unknown");
    assert.equal(missing.observation.citationSetState, "missing");
    assert.equal(missing.citationPool.inC, false);
    assert.equal(missing.citationPool.reason, "citation-fields-missing");

    const unsupported = saved.get("unsupported");
    assert.equal(unsupported.citationPool.inC, false);
    assert.equal(unsupported.citationPool.reason, "unsupported");

    const replay = await ingestAdoptedObservation(db, owner, ingestInput(complete.observation.slotId), clock, cache);
    assert.equal(replay.replayed, true);
    assert.equal(replay.observation.id, complete.observation.id);
    assert.equal(replay.observation.answerText, complete.observation.answerText);
    const [countRow] = await queryWithParameters(db, `SELECT COUNT(*) AS count FROM answer_observation WHERE slot_id = ?`, [complete.observation.slotId]);
    assert.equal(Number(countRow.count), 1);

    const emptySlotId = empty.observation.slotId;
    const raced = await Promise.all([
      ingestAdoptedObservation(db, owner, ingestInput(emptySlotId), clock, cache),
      ingestAdoptedObservation(db, owner, ingestInput(emptySlotId), clock, cache),
    ]);
    assert.equal(raced.every((item) => item.observation.id === empty.observation.id), true);
    const [racedCount] = await queryWithParameters(db, `SELECT COUNT(*) AS count FROM answer_observation WHERE slot_id = ?`, [emptySlotId]);
    assert.equal(Number(racedCount.count), 1);

    const beforeText = complete.observation.answerText;
    const revised = await reviseAnalysis(db, owner, {
      action: "revise-analysis",
      brandId: brand,
      observationId: complete.observation.id,
      expectedVersion: 1,
      operationId: randomUUID(),
      mentioned: "false",
      recommended: "false",
      officialSiteCited: "unknown",
      reason: "同名误判",
    }, clock, cache);
    assert.equal(revised.observation.answerText, beforeText);
    assert.equal(revised.observation.fingerprint, complete.observation.fingerprint);
    assert.equal(revised.latestAnalysis.version, 2);
    assert.equal(revised.analyses.length, 2);

    content.questions.find((question) => question.id === byKey.get("missing").id).type = "exploration";
    await queryWithParameters(db, `UPDATE prompt_set SET content = ? WHERE id = ?`, [JSON.stringify(content), setId]);
    await queryWithParameters(db, `UPDATE monitoring_slot SET natural_question = 0 WHERE id = ?`, [unsupported.observation.slotId]);
    await queryWithParameters(db, `UPDATE answer_observation SET answer_text = ? WHERE id = ?`,
      ["[FUNCTIONAL-MOCK] 演示样本不应进入自然分母", saved.get("synthetic").observation.id]);

    const manual = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "消费者入口的独立样本",
      answerText: "乙品牌可以考虑。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "off",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://consumer",
      collectorId: owner,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: null,
    }, clock, cache);
    assert.equal(manual.error, undefined, manual.error);
    assert.equal(manual.observation.sourceMode, "consumer_ui");
    assert.equal(manual.observation.networkTrigger, "unknown");

    const started = performance.now();
    const apiView = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "model_api" }, cache);
    const consumerView = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "consumer_ui" }, cache);
    const elapsed = performance.now() - started;
    assert.equal(apiView.error, undefined);
    assert.equal(consumerView.error, undefined);
    const apiIds = new Set(apiView.sampleIds);
    assert.equal(apiIds.has(complete.observation.id), true);
    assert.equal(apiIds.has(empty.observation.id), true);
    assert.equal(apiIds.has(missing.observation.id), false);
    assert.equal(apiIds.has(unsupported.observation.id), false);
    assert.equal(apiIds.has(saved.get("synthetic").observation.id), false);
    assert.equal(apiIds.has(manual.observation.id), false);
    assert.equal(apiView.metrics.officialSiteCited.status, "na");
    assert.equal(apiView.metrics.officialSiteCited.reason, "official-website-not-applicable");
    assert.equal(apiView.answers.find((item) => item.observationId === complete.observation.id).mentioned, "false");
    assert.ok(consumerView.sampleIds.includes(manual.observation.id));
    assert.equal(consumerView.sampleIds.includes(complete.observation.id), false);

    const scoped = scopedObservationQuery({ ownerId: owner, brandId: brand, sourceMode: "model_api" });
    const plan = await queryWithParameters(db, `${kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN "}${scoped.sql}`, scoped.values);
    console.log(`${kind} official ingest overview ${scoped.sql.split("?").length - 1} params ${elapsed.toFixed(2)} ms`);
    console.log(plan.map((row) => JSON.stringify(row)).join("\n"));
  });
}
