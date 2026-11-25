import { createHash, randomUUID } from "node:crypto";
import { EvidenceDao } from "../../src/features/evidence/dao.ts";
import { MonitoringDao } from "../../src/features/monitoring/dao.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import { ReportDao } from "../../src/features/reports/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";

export async function saveComparisonFixture(db, owner, brandId) {
  const beforeAt = "2026-11-01T12:00:00.000Z";
  const afterAt = "2026-11-10T12:00:00.000Z";
  const beforeSetId = randomUUID();
  const afterSetId = randomUUID();
  const channelId = randomUUID();
  const protocolId = randomUUID();
  const clusterId = randomUUID();
  const questions = ["q1", "q2", "q3", "q4"].map((name) => ({
    id: randomUUID(), clusterId, text: `Synthetic buying question ${name}?`,
    type: "discovery", source: "manual", sourceNote: "", stage: "awareness", region: "CN",
    language: "zh-CN", status: "confirmed", acceptSimilar: false, primary: true,
  }));
  const clusters = [{ id: clusterId, audience: "Fixture", intent: "Fixture", primaryPage: "", conversionAction: "" }];
  const afterQuestions = questions.map((question, index) =>
    index === 3 ? { ...question, text: "Synthetic modified buying question?" } : question);
  const prompts = new PromptDao(db, brandId);
  const monitoring = new MonitoringDao(db);
  const evidence = new EvidenceDao(db);
  await queryWithParameters(db, `INSERT INTO sampling_protocol
    (id, protocol_id, brand_id, owner_id, version, new_session_required, search_required, target_region,
      timezone, status, fingerprint, operation_id, created_at)
    VALUES (?, ?, ?, ?, 1, 0, 0, 'CN', 'Asia/Shanghai', 'frozen', ?, ?, ?)`,
  [randomUUID(), protocolId, brandId, owner, "a".repeat(64), randomUUID(), beforeAt]);

  async function window(at, setId, version, items) {
    const runId = randomUUID();
    await prompts.insertSet({
      id: setId, setId: beforeSetId, version, entityVersion: 1, region: "CN", language: "zh-CN",
      content: { clusters, questions: items }, createdAt: at,
    });
    await monitoring.insertRun({
      id: runId, brandId, ownerId: owner, operationId: randomUUID(), fingerprint: "b".repeat(64),
      track: "model_api", promptSetId: setId, promptSetVersion: version, repeatCount: 1,
      questionCount: 4, naturalCount: 4, channelCount: 1, slotCount: 4,
      region: "CN", language: "zh-CN", requestedNetworkMode: "off", currency: "CNY",
      upperMinor: 0, estimateHighMinor: 0, createdAt: at,
    });
    await queryWithParameters(db, `INSERT INTO run_protocol_pin
      (run_id, brand_id, owner_id, protocol_id, version, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
    [runId, brandId, owner, protocolId, at]);
    const slots = items.map((question) => ({
      id: randomUUID(), runId, brandId, questionId: question.id, natural: 1, channelId, channelVersion: 2,
      repeatIndex: 1, reservationId: null, createdAt: at,
    }));
    await monitoring.insertSlots(slots);
    const samples = [];
    for (const [index, question] of items.entries()) {
      const observationId = randomUUID();
      await evidence.insertObservation({
        id: observationId, brandId, ownerId: owner, slotId: slots[index].id, attemptId: null,
        sourceMode: "model_api", captureMethod: "isolated", questionText: question.text,
        answerText: "Synthetic answer for isolated report tests", fingerprint: "c".repeat(64),
        region: "CN", targetRegion: "CN", observedRegion: "unknown", newSession: "unknown", productMode: "unknown",
        networkTrigger: "not_triggered", language: "zh-CN", requestedNetworkMode: "off", entityVersion: 1,
        citationSetState: index === 1 ? "partial" : "complete", evidenceState: "complete",
        locatorRef: null, collectorId: null, missingReason: null, capturedAt: at, createdAt: at,
      });
      const analysisId = randomUUID();
      await evidence.insertAnalysis({
        id: analysisId, observationId, brandId, version: 1, entityVersion: 1, ruleVersion: "fixture-v1",
        mentioned: version === 1 || index === 0 ? "true" : "false",
        recommended: version === 2 && index !== 1 ? "true" : "false",
        officialSiteCited: index === 2 ? "unknown" : "true",
        evidenceSpan: null, status: "classified", revisedFrom: null, reason: null, reviewerId: null, createdAt: at,
      });
      // Intentionally wrong caller counts and dimensions for the report write.
      samples.push({
        observationId, queryId: `q${index + 1}`, queryVersion: `q${index + 1}-v${index === 3 ? version : 1}`,
        track: "model_api", channelVersion: "untrusted-channel", protocolVersion: "untrusted-protocol",
        analysisRuleVersion: "untrusted-analysis", region: "SG", entityVersion: 1,
        judgable: true, numerator: 50, denominator: 100,
      });
    }
    return samples;
  }

  return {
    questionIds: questions.map((question) => question.id),
    before: { start: "2026-11-01", endExclusive: "2026-11-08", samples: await window(beforeAt, beforeSetId, 1, questions) },
    after: { start: "2026-11-09", endExclusive: "2026-11-16", samples: await window(afterAt, afterSetId, 2, afterQuestions) },
  };
}

export async function saveLegacySnapshot(db, ownerId, brandId, retestId) {
  const id = randomUUID();
  const json = JSON.stringify({
    schema_version: "report-v3", report_id: id, metric: "recommendation_rate",
    summary: { common_query_count: 3, delta_pp: 10 },
    cost: { status: "summarized", known: [{ currency: "CNY", minor: 3 }], pending_count: 1 },
    labor: { status: "not_applicable", reason: "unrecorded" },
  });
  const html = "<!doctype html><h1>Historical recommendation rate</h1><p>CNY 3 minor units</p>";
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  await new ReportDao(db).insertSnapshot({
    id, brandId, ownerId, retestId, status: "created", grade: "exploratory", intent: "diagnostic",
    loopCompleted: 0, predecessorId: null, entityVersion: 1, timezone: "Asia/Shanghai", locale: "en",
    sourceMissing: 0, jsonBytes: json, htmlBytes: html, jsonSha256: sha(json), htmlSha256: sha(html),
    operationId: randomUUID(), createdAt: "2026-11-17T12:00:00.000Z", htmlObjectId: null, jsonObjectId: null,
  });
  return { id, json, html };
}

export async function correctRecommendation(db, observationId) {
  const dao = new EvidenceDao(db);
  const previous = await dao.latestAnalysis(observationId);
  await dao.insertAnalysis({
    ...previous, id: randomUUID(), version: previous.version + 1, recommended: "true",
    revisedFrom: previous.id, status: "classified", createdAt: "2026-11-11T12:00:00.000Z",
  });
}
