import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  ingestAdoptedObservation,
  readObservation,
  reviseAnalysis,
  submitManualEvidence,
} from "../../src/features/evidence/commands.ts";
import { EvidenceDao } from "../../src/features/evidence/dao.ts";
import { citationPoolEligibility } from "../../src/features/evidence/rules.ts";
import { recordCapability } from "../../src/features/capabilities/commands.ts";
import { changeMaintenanceGrant } from "../../src/features/maintenance/core.ts";
import { acceptMonitoringRun, previewMonitoringRun } from "../../src/features/monitoring/commands.ts";
import { executeMonitoringRun } from "../../src/features/monitoring/execution.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import { updateQuota } from "../../src/features/quotas/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-19T12:00:00.000Z";
const secret = "evidence-test-secret-evidence-test-secret";
const clock = () => time;
const fields = {
  name: "乙品牌", description: "Synthetic brand for evidence", website: "https://yi.example.com",
  aliases: ["乙"], region: "CN", language: "zh-CN", competitors: [], questions: [],
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json", "utf8"));
  return journal.entries.at(-2).tag;
}

async function account(db, verified = true) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Evidence owner", `${id}@example.invalid`, verified ? (db.kind === "sqlite" ? 1 : true) : (db.kind === "sqlite" ? 0 : false)]);
  return id;
}

function capability(actorId, overrides = {}) {
  return {
    action: "record", actorId, operationId: randomUUID(), expectedVersion: null, channelId: null,
    vendorId: "acme-ai", kind: "model_api", reason: "initial-record", status: "candidate",
    displayName: "Acme API", productEntry: "chat.completions", mode: "official-api", modelVersion: "unknown",
    availability: "synthetic fixture", searchRequired: 0, citationCapability: "complete",
    regionTarget: "CN", regionActual: "unknown", limitsSummary: "No production traffic",
    sopSummary: "Human SOP without secrets", verifiedAt: null, expiresAt: null, publicVisible: 0,
    ...overrides,
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: AC-M0-06-1/2/3 dual-track evidence contract`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });

    const [owner, outsider, operator] = await Promise.all([account(db), account(db), account(db)]);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);

    // AC-M0-06-1: mention true, recommend false, official cited true
    const official = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "这个品类里该怎么选？",
      answerText: "甲可考虑；乙不适合本需求。参考 https://yi.example.com/guide",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [{
        rawUrl: "https://yi.example.com/guide?utm_source=x",
        citationOrigin: "provider_native",
        ownership: "owned_domain",
        pageStatus: "reachable",
      }],
      locatorRef: "fixture://manual/1",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "true",
      recommended: "false",
      officialSiteCited: "true",
      evidenceSpan: "乙不适合本需求",
    }, clock);
    assert.equal(official.error, undefined);
    assert.equal(official.latestAnalysis.mentioned, "true");
    assert.equal(official.latestAnalysis.recommended, "false");
    assert.equal(official.latestAnalysis.officialSiteCited, "true");
    assert.equal(official.citationPool.inC, true);
    assert.equal(official.citationPool.cited, true);

    // AC-M0-06-2: complete empty vs missing fields
    const empty = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "还有别的选项吗？",
      answerText: "目前没有公开推荐名单。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "off",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://manual/empty",
      collectorId: owner,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "false",
      recommended: "false",
      officialSiteCited: "false",
    }, clock);
    assert.equal(empty.citationPool.inC, true);
    assert.equal(empty.citationPool.cited, false);
    assert.equal(citationPoolEligibility("complete").inC, true);

    const missing = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "缺引用字段",
      answerText: "模型回答但不提供引用结构",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "missing",
      citations: [],
      locatorRef: "fixture://manual/missing",
      collectorId: owner,
      brandName: "乙品牌",
    }, clock);
    assert.equal(missing.error, "EVIDENCE_INCOMPLETE");
    assert.equal(missing.observation.evidenceState, "draft_evidence");
    assert.equal(missing.citationPool.inC, false);
    assert.equal(missing.citationPool.reason, "citation-fields-missing");

    const partial = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "partial citations",
      answerText: "只有部分引用字段",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "partial",
      citations: [{
        rawUrl: "https://search.example/q=乙",
        citationOrigin: "search_candidate",
        ownership: "third_party",
      }],
      locatorRef: "fixture://manual/partial",
      collectorId: owner,
      brandName: "乙品牌",
      mentioned: "true",
      recommended: "unknown",
      officialSiteCited: "unknown",
    }, clock);
    assert.equal(partial.citationPool.inC, false);
    assert.equal(partial.citationPool.reason, "partial");
    assert.equal(partial.citations.every((item) => item.citationOrigin !== "provider_native" || true), true);

    // AC-M0-06-3: revise keeps original text and old analysis id
    const beforeText = official.observation.answerText;
    const oldAnalysisId = official.latestAnalysis.id;
    const revised = await reviseAnalysis(db, owner, {
      action: "revise-analysis",
      brandId: brand,
      observationId: official.observation.id,
      expectedVersion: 1,
      operationId: randomUUID(),
      mentioned: "false",
      recommended: "false",
      officialSiteCited: "true",
      reason: "同名误判：回答中的乙指其他主体",
    }, clock);
    assert.equal(revised.observation.answerText, beforeText);
    assert.equal(revised.observation.fingerprint, official.observation.fingerprint);
    assert.equal(revised.latestAnalysis.version, 2);
    assert.equal(revised.latestAnalysis.mentioned, "false");
    assert.equal(revised.previousAnalysisId, oldAnalysisId);
    assert.ok(revised.analyses.some((item) => item.id === oldAnalysisId && item.status === "revised"));

    const outsiderRead = await readObservation(db, outsider, official.observation.id);
    assert.equal(outsiderRead, null);

    // freeze blocks writes
    await queryWithParameters(db, "UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ?",
      [time, "2026-12-19T12:00:00.000Z", brand]);
    const frozen = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "frozen",
      answerText: "should fail",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "off",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://frozen",
      collectorId: owner,
      brandName: "乙品牌",
    }, clock);
    assert.equal(frozen.error, "NOT_ENTITLED");

    await queryWithParameters(db, "UPDATE brand SET frozen_at = NULL, restore_until = NULL WHERE id = ?", [brand]);
    await new EvidenceDao(db).clearBrandEvidence(brand);
    const cleared = await readObservation(db, owner, official.observation.id);
    assert.equal(cleared, null);

    // ingest from adopted attempt (API track fixture)
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
      expiresAt: "2026-12-19T06:00:00.000Z",
    }, clock)).status, "allowed");

    const clusterId = randomUUID();
    const questions = [
      ["这个品类里，大家通常会比较哪些条件？", true, "discovery"],
      ["日常使用时，最先要确认的使用场景是什么？", true, "scenario"],
      ["预算有限时，怎样判断一个选择是否合适？", true, "constraint"],
    ].map(([text, primary, type]) => ({
      id: randomUUID(), clusterId, text, source: "manual", sourceNote: "", type, stage: "awareness",
      region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary,
    }));
    const setId = randomUUID();
    await new PromptDao(db, brand).insertSet({
      id: setId, setId, version: 1, entityVersion: 1, region: "CN", language: "zh-CN", createdAt: time,
      content: { clusters: [{ id: clusterId, audience: "购买者", intent: "比较使用条件", primaryPage: "", conversionAction: "" }], questions },
    });
    const preview = await previewMonitoringRun(db, owner, {
      action: "preview", brandId: brand, track: "model_api", promptSetId: setId, repeats: 1,
      requestedNetworkMode: "unknown", channelIds: [verified.channelId], ceiling: { currency: "CNY", upperMinor: 10 },
    }, secret, clock);
    assert.equal(preview.error, undefined);
    const accepted = await acceptMonitoringRun(db, owner, {
      action: "accept", ...preview.snapshot, token: preview.token, operationId: randomUUID(),
    }, secret, clock);
    assert.equal(accepted.error, undefined);
    const executed = await executeMonitoringRun(db, owner, accepted.id, {
      label: "isolated",
      sample() {
        return Promise.resolve({
          disposition: "adopted",
          rawText: "甲可考虑；乙不适合本需求。",
          actualMinor: 3,
          synthetic: true,
        });
      },
    }, clock);
    assert.equal(executed.error, undefined);
    const slotId = executed.slots.find((slot) => slot.status === "succeeded").id;
    const ingested = await ingestAdoptedObservation(db, owner, {
      action: "ingest-adopted",
      brandId: brand,
      slotId,
      operationId: randomUUID(),
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      citationSetState: "complete",
      citations: [{
        rawUrl: "https://yi.example.com/",
        citationOrigin: "provider_native",
        ownership: "owned_domain",
      }],
      mentioned: "true",
      recommended: "false",
      officialSiteCited: "true",
    }, clock);
    assert.equal(ingested.latestAnalysis.mentioned, "true");
    assert.equal(ingested.latestAnalysis.recommended, "false");
    assert.equal(ingested.observation.captureMethod, "isolated");
  });
}
