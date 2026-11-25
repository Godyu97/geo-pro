import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { recordCapability } from "../../src/features/capabilities/commands.ts";
import { changeMaintenanceGrant } from "../../src/features/maintenance/core.ts";
import { acceptMonitoringRun, previewMonitoringRun } from "../../src/features/monitoring/commands.ts";
import { cancelMonitoringRun, continueMonitoringRun, executeMonitoringRun, pauseMonitoringRun, reconcileMonitoringCost } from "../../src/features/monitoring/execution.ts";
import { createSamplingProtocol, freezeSamplingProtocol, pinSamplingProtocol } from "../../src/features/monitoring/protocol-commands.ts";
import { createOfficialSamplingPort, officialSamplingPortFromEnv } from "../../src/features/monitoring/official-port.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import { updateQuota } from "../../src/features/quotas/commands.ts";
import { interpretOfficialPayload, parseOfficialReceipt, safeFailureOfficialSample, serializeOfficialReceipt } from "../../src/lib/ai/official-sampling.ts";
import { classifyLabels, officialAttemptCapture } from "../../src/features/evidence/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-19T06:00:00.000Z";
const later = "2026-11-25T06:00:00.000Z";
const secret = "official-sampling-test-secret-value";
const apiKey = "loopback-official-key";
const clock = () => time;
const fields = {
  name: "Synthetic", description: "Synthetic brand for official sampling", website: "", aliases: [],
  region: "CN", language: "zh-CN", competitors: [], questions: [],
};
const priceTable = {
  currency: "CNY",
  models: { "fixture-model": { inputMinorPerMillion: 1_000_000, outputMinorPerMillion: 2_000_000 } },
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json", "utf8"));
  return journal.entries.at(-2).tag;
}

async function account(db, verified = true) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Synthetic official", `${id}@example.invalid`, verified ? (db.kind === "sqlite" ? 1 : true) : (db.kind === "sqlite" ? 0 : false)]);
  return id;
}

function capability(actorId, overrides = {}) {
  return {
    action: "record", actorId, operationId: randomUUID(), expectedVersion: null, channelId: null,
    vendorId: "fixture-ai", kind: "model_api", reason: "initial-record", status: "candidate",
    displayName: "Fixture API", productEntry: "official-responses", mode: "official-api", modelVersion: "fixture-model",
    availability: "loopback contract", searchRequired: 1, citationCapability: "complete",
    regionTarget: "CN", regionActual: "unknown", limitsSummary: "Loopback contract only",
    sopSummary: "No production credential", verifiedAt: null, expiresAt: null, publicVisible: 0,
    ...overrides,
  };
}

async function verifiedChannel(db, operator, when, expiresAt) {
  const recorded = await recordCapability(db, operator, capability(operator), () => when);
  const api = recorded.data.after;
  const verified = await recordCapability(db, operator, capability(operator, {
    expectedVersion: 1, channelId: api.channelId, reason: "verification", status: "verified",
    verifiedAt: when, expiresAt, publicVisible: 0,
  }), () => when);
  return verified.data.after;
}

async function prepare(db, env, expiresAt) {
  await migrateThrough(db, previousTag(db.kind));
  execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const [owner, operator] = await Promise.all([account(db), account(db, false)]);
  const brand = randomUUID();
  await new BrandDao(db).insertBrand(owner, brand, time);
  await new BrandDao(db).insertVersion(brand, 1, fields, time);
  for (const permission of ["capabilities.manage", "quotas.manage"]) {
    assert.equal((await changeMaintenanceGrant(db, {
      action: "grant", operatorId: operator, userId: operator, permission, reason: "initial-setup",
    })).status, "allowed");
  }
  const channel = await verifiedChannel(db, operator, time, expiresAt);
  assert.equal((await updateQuota(db, operator, {
    action: "set", actorId: operator, brandId: brand, kind: "sampling", operationId: randomUUID(),
    expectedVersion: null, reason: "pilot-approval", countLimit: 40, budgetMinor: 50_000, currency: "CNY",
    expiresAt: "2026-12-19T06:00:00.000Z",
  }, clock)).status, "allowed");
  return { owner, operator, brand, channel };
}

function questions() {
  const clusterId = randomUUID();
  const specs = [
    ["Q01 这个品类里大家通常会比较哪些条件", "discovery", true],
    ["Q02 日常使用时最先要确认的场景是什么", "scenario", true],
    ["Q03 预算有限时怎样判断一个选择是否合适", "constraint", true],
    ["Q04 首次接触这个品类时会看哪些公开说明", "discovery", true],
    ["Q05 持续使用一段时间后哪些限制最常见", "scenario", true],
    ["Q06 遇到不稳定结果时用户会如何复核", "constraint", true],
    ["Q07 选择之前还会确认哪些维护条件", "discovery", true],
    ["Q08 和甲品牌相比这个方案适合哪些限制", "comparison", false],
    ["Q09 和乙品牌相比这个方案适合哪些限制", "comparison", false],
    ["Q10 和丙品牌相比这个方案适合哪些限制", "comparison", false],
  ];
  return {
    clusters: [{ id: clusterId, audience: "购买者", intent: "比较使用条件", primaryPage: "", conversionAction: "" }],
    questions: specs.map(([text, type, primary]) => ({
      id: randomUUID(), clusterId, text, source: "manual", sourceNote: "", type, stage: "awareness",
      region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary,
    })),
  };
}

async function acceptRun(db, owner, brand, channelId, repeats) {
  const content = questions();
  const setId = randomUUID();
  await new PromptDao(db, brand).insertSet({
    id: setId, setId, version: 1, entityVersion: 1, region: "CN", language: "zh-CN", createdAt: time, content,
  });
  const preview = await previewMonitoringRun(db, owner, {
    action: "preview", brandId: brand, track: "model_api", promptSetId: setId, repeats,
    requestedNetworkMode: "on", channelIds: [channelId], ceiling: { currency: "CNY", upperMinor: 100 },
  }, secret, clock);
  assert.equal(preview.error, undefined, preview.error);
  return acceptMonitoringRun(db, owner, {
    action: "accept", ...preview.snapshot, token: preview.token, operationId: randomUUID(),
  }, secret, clock);
}

function payload(code, geo, extra = {}) {
  return {
    id: `resp-${code}`, status: "completed", model: "fixture-model",
    output_text: `官方回答 ${code}`,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: `官方回答 ${code}` }] }],
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    geo_sampling: geo,
    ...extra,
  };
}

function scriptedBody(code) {
  if (code === "Q01" || code === "Q06") return payload(code, { network_trigger: "triggered", citations: [{ url: `https://example.com/${code}`, title: "来源" }] });
  if (code === "Q02") return payload(code, { network_trigger: "triggered", citations: [] });
  if (code === "Q03") return payload(code, { network_trigger: "triggered" });
  if (code === "Q04") return payload(code, { network_trigger: "triggered", citation_support: "unsupported", citations: [{ url: "https://example.com/Q04" }] });
  if (code === "Q05") return payload(code, { citations: [] });
  if (code === "Q09") return payload(code, { network_trigger: "triggered", citations: [{ url: "https://example.com/Q09" }] }, { model: "other-model" });
  if (code === "Q10") {
    return payload(code, {
      network_trigger: "triggered",
      citations: [{ url: "https://example.com/Q10" }, { title: "缺链接" }],
    }, { usage: { input_tokens: 1000, output_tokens: 1, total_tokens: 1001 } });
  }
  return null;
}

async function listen(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      requests.push({ url: req.url, authorization: req.headers.authorization, body });
      handler(req, res, body);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("official adapter stays closed without config and does not follow redirects", async () => {
  const eligible = {
    channelId: randomUUID(), kind: "model_api", status: "verified", productEntry: "official-responses",
    modelVersion: "fixture-model", verifiedAt: time, expiresAt: "2026-12-19T06:00:00.000Z",
  };
  assert.equal(officialSamplingPortFromEnv({}).probe(eligible, time).open, false);
  const leaked = [];
  const redirect = await listen((req, res) => {
    if (req.url !== "/responses") leaked.push(req.url);
    res.writeHead(302, { Location: "/leak" });
    res.end();
  });
  try {
    const port = createOfficialSamplingPort({
      baseUrl: redirect.baseUrl, apiKey, productEntry: "official-responses", priceTable, timeoutMs: 200,
    });
    const sample = await port.sample({
      slotId: randomUUID(), questionId: randomUUID(), channelId: eligible.channelId, ordinal: 1,
      questionText: "重定向时是否带出凭据", requestedNetworkMode: "off", upperMinor: 100, currency: "CNY", now: time,
      capability: { ...eligible, version: 1, citationCapability: "complete", searchRequired: 0 },
    });
    assert.equal(sample.disposition, "unknown");
    assert.equal(sample.reconciliationRequired, true);
    assert.equal(redirect.requests.length, 1);
    assert.equal(redirect.requests[0].url, "/responses");
    assert.equal(leaked.length, 0);
    assert.equal(JSON.stringify(sample).includes(apiKey), false);
  } finally {
    await redirect.close();
  }

  const accepted = await listen((_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "resp-accepted", error: { message: "failed after accept" } }));
  });
  try {
    const port = createOfficialSamplingPort({
      baseUrl: accepted.baseUrl, apiKey, productEntry: "official-responses", priceTable, timeoutMs: 200,
    });
    const sample = await port.sample({
      slotId: randomUUID(), questionId: randomUUID(), channelId: eligible.channelId, ordinal: 1,
      questionText: "已受理失败不得重发", requestedNetworkMode: "off", upperMinor: 100, currency: "CNY", now: time,
      capability: { ...eligible, version: 1, citationCapability: "complete", searchRequired: 0 },
    });
    assert.equal(sample.disposition, "unknown");
    assert.equal(accepted.requests.length, 1);
    assert.equal(JSON.stringify(sample).includes(apiKey), false);
  } finally {
    await accepted.close();
  }
});

test("a broken connection after POST does not authorize another request", async (t) => {
  const server = await listen((req) => req.socket.destroy());
  t.after(() => server.close());
  const port = createOfficialSamplingPort({
    baseUrl: server.baseUrl, apiKey, productEntry: "official-responses", priceTable, timeoutMs: 200,
  });
  const channelId = randomUUID();
  const result = await port.sample({
    slotId: randomUUID(), questionId: randomUUID(), channelId, ordinal: 1,
    questionText: "连接断开后是否保留预留", requestedNetworkMode: "off", upperMinor: 100, currency: "CNY", now: time,
    capability: {
      channelId, version: 1, kind: "model_api", status: "verified", productEntry: "official-responses",
      modelVersion: "fixture-model", verifiedAt: time, expiresAt: later, citationCapability: "complete", searchRequired: 0,
    },
  });
  assert.equal(result.disposition, "unknown");
  assert.equal(server.requests.length, 1);
});

test("official receipts retain intact URLs and downgrade incomplete citation sets", () => {
  const citations = Array.from({ length: 40 }, (_, index) => ({
    url: `https://example.com/${index}/${"a".repeat(1800)}`, title: "公开参考", position: index + 1,
  }));
  const receipt = parseOfficialReceipt(serializeOfficialReceipt({
    responseId: "resp-many", modelVersion: "fixture-model",
    networkTrigger: "triggered", citationSetState: "complete", citations,
  }));
  assert.equal(receipt.responseId, "resp-many");
  assert.equal(receipt.citationSetState, "partial");
  assert.ok(receipt.citations.length > 0 && receipt.citations.length < citations.length);
  assert.deepEqual(receipt.citations, citations.slice(0, receipt.citations.length));
  assert.equal(receipt.searchResults, undefined);
});

test("an explicit search list does not complete or fill native citations", () => {
  const base = {
    httpStatus: 200,
    requestedModel: "fixture-model",
    requestedNetworkMode: "on",
    citationCapability: "complete",
    priceTable,
    currency: "CNY",
    upperMinor: 100,
  };
  const bodyOnly = interpretOfficialPayload({
    ...base,
    payload: {
      id: "resp-body", status: "completed", model: "fixture-model",
      output_text: "见 https://body.example/guess",
      output: [{ type: "message", content: [{ type: "output_text", text: "见 https://body.example/guess" }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      geo_sampling: { network_trigger: "triggered", citations: [] },
    },
  });
  assert.equal(bodyOnly.citationSetState, "complete");
  assert.equal(bodyOnly.citations.length, 0);
  assert.equal(bodyOnly.searchResults.length, 0);

  const listed = interpretOfficialPayload({
    ...base,
    payload: {
      id: "resp-search", status: "completed", model: "fixture-model",
      output_text: "没有把搜索结果写成引用。",
      output: [
        { type: "web_search_call", status: "completed", action: { type: "search", sources: [{ type: "url", url: "https://search.example/a?utm_source=1" }, { url: "not a url" }] } },
        { type: "message", content: [{ type: "output_text", text: "没有把搜索结果写成引用。", annotations: [{ type: "url_citation", url: "https://native.example/cited" }] }] },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      geo_sampling: {
        network_trigger: "triggered",
        citation_support: "complete",
        citations: [],
        search_results: [{ url: "https://search.example/explicit?fbclid=2", title: "候选" }, { url: "notaurl" }],
      },
    },
  });
  assert.equal(listed.citationSetState, "complete");
  assert.equal(listed.citations.length, 0);
  assert.equal(listed.searchResults.length, 1);
  assert.equal(listed.searchResults[0].url, "https://search.example/explicit?fbclid=2");
  const fromTool = interpretOfficialPayload({
    ...base,
    payload: {
      id: "resp-tool", status: "completed", model: "fixture-model",
      output_text: "引用与搜索分开。",
      output: [
        { type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url: "https://search.example/tool" }] } },
        { type: "message", content: [{ type: "output_text", text: "引用与搜索分开。", annotations: [{ type: "url_citation", url: "https://native.example/cited" }] }] },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      geo_sampling: { network_trigger: "triggered" },
    },
  });
  assert.equal(fromTool.citationSetState, "complete");
  assert.deepEqual(fromTool.citations.map((item) => item.url), ["https://native.example/cited"]);
  assert.deepEqual(fromTool.searchResults.map((item) => item.url), ["https://search.example/tool"]);
  const captured = officialAttemptCapture(serializeOfficialReceipt(listed));
  assert.equal(captured.citationSetState, "complete");
  assert.equal(captured.citations.length, 1);
  assert.equal(captured.citations[0].citationOrigin, "search_candidate");
  const labels = classifyLabels({
    answerText: "没有把搜索结果写成引用。",
    brandName: "乙品牌",
    officialWebsite: "https://search.example",
    citations: captured.citations,
  });
  assert.equal(labels.officialSiteCited, "false");
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: official sampling fails closed before quota use`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const { owner, brand, channel } = await prepare(db, fixture.env, "2026-11-20T06:00:00.000Z");
    const accepted = await acceptRun(db, owner, brand, channel.channelId, 1);
    const closed = await executeMonitoringRun(db, owner, accepted.id, officialSamplingPortFromEnv({}), clock);
    assert.equal(closed.error, "REAL_CHANNEL_CLOSED");
    const server = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    t.after(() => server.close());
    const mismatched = createOfficialSamplingPort({
      baseUrl: server.baseUrl, apiKey, productEntry: "other-entry", priceTable, timeoutMs: 200,
    });
    const mismatch = await executeMonitoringRun(db, owner, accepted.id, mismatched, clock);
    assert.equal(mismatch.error, "REAL_CHANNEL_CLOSED");
    assert.equal(server.requests.length, 0);
    const expired = await executeMonitoringRun(db, owner, accepted.id, createOfficialSamplingPort({
      baseUrl: server.baseUrl, apiKey, productEntry: "official-responses", priceTable, timeoutMs: 200,
    }), () => later);
    assert.equal(expired.error, "CHANNEL_UNVERIFIED");
    assert.equal(server.requests.length, 0);
    const [attempts] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM monitoring_attempt WHERE run_id = ?", [accepted.id]);
    const [ledger] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM quota_attempt WHERE brand_id = ?", [brand]);
    assert.equal(Number(attempts.count), 0);
    assert.equal(Number(ledger.count), 0);
    const reservations = await queryWithParameters(db, "SELECT state FROM quota_reservation WHERE brand_id = ?", [brand]);
    assert.equal(reservations.every((row) => row.state === "reserved"), true);
  });

  test(`${kind}: official adapter completes the 10x2 loopback contract`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const { owner, brand, channel } = await prepare(db, fixture.env, "2026-12-19T06:00:00.000Z");
    const content = questions();
    const setId = randomUUID();
    await new PromptDao(db, brand).insertSet({
      id: setId, setId, version: 1, entityVersion: 1, region: "CN", language: "zh-CN", createdAt: time, content,
    });
    const preview = await previewMonitoringRun(db, owner, {
      action: "preview", brandId: brand, track: "model_api", promptSetId: setId, repeats: 2,
      requestedNetworkMode: "on", channelIds: [channel.channelId], ceiling: { currency: "CNY", upperMinor: 100 },
    }, secret, clock);
    assert.equal(preview.error, undefined, preview.error);
    const accepted = await acceptMonitoringRun(db, owner, {
      action: "accept", ...preview.snapshot, token: preview.token, operationId: randomUUID(),
    }, secret, clock);
    assert.equal(accepted.slotCount, 20);
    const counts = new Map();
    const server = await listen((req, res, body) => {
      const code = String(body?.input ?? "").slice(0, 3);
      if (req.url !== "/responses") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (code === "Q07") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "unavailable" } }));
        return;
      }
      if (code === "Q08") return;
      if (code === "Q06") {
        const seen = (counts.get(body.input) ?? 0) + 1;
        counts.set(body.input, seen);
        if (seen <= 2) {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "slow down" } }));
          return;
        }
      }
      const script = scriptedBody(code);
      res.writeHead(script ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(script ?? { error: { message: "unknown question" } }));
    });
    t.after(() => server.close());
    const port = createOfficialSamplingPort({
      baseUrl: server.baseUrl, apiKey, productEntry: "official-responses", priceTable, timeoutMs: 200,
    });
    const seen = [];
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.map((item) => String(item)).join(" "));
    const wrapped = {
      label: "official_api",
      probe: (gate, now) => port.probe(gate, now),
      priced: (model, currency) => port.priced(model, currency),
      sample: async (input) => {
        const sample = await port.sample(input);
        seen.push({ questionId: input.questionId, sample });
        return sample;
      },
    };
    let again;
    try {
      const executed = await executeMonitoringRun(db, owner, accepted.id, wrapped, clock);
      assert.equal(executed.error, undefined, executed.error);
      again = await executeMonitoringRun(db, owner, accepted.id, wrapped, clock);
      assert.equal(again.error, undefined, again.error);
    } finally {
      console.error = original;
    }
    const byCode = (code) => server.requests.filter((item) => String(item.body?.input ?? "").startsWith(code));
    assert.equal(server.requests.every((item) => item.url === "/responses" && item.authorization === `Bearer ${apiKey}` && item.body.tools?.[0]?.type === "web_search"), true);
    for (const code of ["Q01", "Q02", "Q03", "Q04", "Q05", "Q09", "Q10"]) assert.equal(byCode(code).length, 2, code);
    assert.equal(byCode("Q06").length, 4);
    assert.equal(byCode("Q07").length, 2);
    assert.equal(byCode("Q08").length, 2);
    assert.equal(errors.some((line) => line.includes(apiKey)), false);
    const codeByQuestion = new Map(content.questions.map((question) => [question.id, question.text.slice(0, 3)]));
    const samplesFor = (code) => seen.filter((item) => codeByQuestion.get(item.questionId) === code).map((item) => item.sample);
    assert.equal(samplesFor("Q01").every((sample) => sample.disposition === "adopted" && sample.citationSetState === "complete" && sample.citations.length === 1 && sample.networkTrigger === "triggered" && sample.actualMinor === 11), true);
    assert.equal(samplesFor("Q02").every((sample) => sample.disposition === "adopted" && sample.citationSetState === "complete" && sample.citations.length === 0), true);
    assert.equal(samplesFor("Q03").every((sample) => sample.citationSetState === "missing" && sample.disposition === "adopted"), true);
    assert.equal(samplesFor("Q04").every((sample) => sample.citationSetState === "unsupported" && sample.disposition === "adopted"), true);
    assert.equal(samplesFor("Q05").every((sample) => sample.networkTrigger === "unknown" && sample.citationSetState === "complete" && sample.disposition === "adopted"), true);
    assert.equal(samplesFor("Q06").filter((sample) => sample.disposition === "adopted" && sample.actualMinor === 11).length, 2);
    assert.equal(samplesFor("Q07").every((sample) => sample.disposition === "unknown" && sample.rawText === null), true);
    assert.equal(samplesFor("Q08").every((sample) => sample.disposition === "unknown" && sample.reconciliationRequired === true && sample.costState === "unknown"), true);
    assert.equal(samplesFor("Q09").every((sample) => sample.disposition === "unknown" && sample.modelVersion === "other-model" && sample.citationSetState === "complete"), true);
    assert.equal(samplesFor("Q10").every((sample) => sample.disposition === "unknown" && sample.citationSetState === "partial" && sample.citations.length === 1), true);
    assert.equal(JSON.stringify(seen).includes(apiKey), false);
    assert.equal(again.slotCount, 20);
    assert.equal(byCode("Q08").length, 2);
    const slots = again.slots;
    const slotCode = new Map(slots.map((slot) => [slot.id, codeByQuestion.get(slot.questionId)]));
    const withCode = (code) => slots.filter((slot) => slotCode.get(slot.id) === code);
    for (const code of ["Q01", "Q02", "Q03", "Q04", "Q05", "Q06"]) assert.equal(withCode(code).every((slot) => slot.status === "succeeded"), true, code);
    for (const code of ["Q07", "Q08", "Q09", "Q10"]) assert.equal(withCode(code).every((slot) => slot.status === "reconciliation_required"), true, code);
    const attempts = await queryWithParameters(db, "SELECT slot_id AS \"slotId\", transport, synthetic, disposition, actual_minor AS \"actualMinor\", cost_state AS \"costState\", raw_text AS \"rawText\", receipt FROM monitoring_attempt WHERE run_id = ? AND kind = 'sampling'", [accepted.id]);
    assert.equal(attempts.every((row) => row.transport === "official_api" && Number(row.synthetic) === 0), true);
    assert.equal(attempts.filter((row) => slotCode.get(row.slotId) === "Q01").every((row) => Number(row.actualMinor) === 11 && row.costState === "known"), true);
    assert.equal(attempts.filter((row) => slotCode.get(row.slotId) === "Q08").every((row) => row.actualMinor === null && row.costState === "unknown"), true);
    assert.equal(attempts.filter((row) => slotCode.get(row.slotId) === "Q07").every((row) => row.costState === "unknown" && row.actualMinor === null && row.rawText === null), true);
    const receipts = attempts.map((attempt) => {
      const receipt = parseOfficialReceipt(attempt.receipt);
      assert.ok(receipt, `Missing receipt for ${attempt.slotId}`);
      return { code: slotCode.get(attempt.slotId), receipt };
    });
    assert.deepEqual(receipts.filter(({ code }) => code === "Q01").map(({ receipt }) => receipt), Array(2).fill({
      responseId: "resp-Q01", modelVersion: "fixture-model", networkTrigger: "triggered", citationSetState: "complete",
      citations: [{ url: "https://example.com/Q01", title: "来源", position: 1 }],
    }));
    assert.deepEqual(receipts.filter(({ code }) => code === "Q08").map(({ receipt }) => receipt), Array(2).fill({
      responseId: null, modelVersion: null, networkTrigger: "unknown", citationSetState: "missing", citations: [],
    }));
    const networks = await queryWithParameters(db, "SELECT actual_network AS \"actualNetwork\", qualifies_required_search AS \"qualifies\" FROM sampling_answer_network WHERE brand_id = ?", [brand]);
    assert.equal(networks.filter((row) => row.actualNetwork === "unknown").length, 6);
    assert.equal(networks.filter((row) => row.actualNetwork === "unknown").every((row) => Number(row.qualifies) === 0), true);
    assert.equal(networks.filter((row) => row.actualNetwork === "true").length, 14);
    const reserved = await queryWithParameters(db, `SELECT s.id FROM monitoring_slot s JOIN quota_reservation r ON r.id = s.reservation_id
      WHERE s.run_id = ? AND s.status = 'reconciliation_required' AND r.state = 'reserved'`, [accepted.id]);
    assert.equal(reserved.length, 8);
    assert.equal(server.requests.length, attempts.length);
  });

  test(`${kind}: official execution claims before the call and recovers unknown cost`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const { owner, operator, brand, channel } = await prepare(db, fixture.env, "2026-12-19T06:00:00.000Z");
    const outsider = await account(db, false);
    const content = {
      clusters: [{ id: randomUUID(), audience: "购买者", intent: "比较使用条件", primaryPage: "", conversionAction: "" }],
      questions: ["HOLD 冻结题一", "SAFE 冻结题二", "LATE 冻结题三"].map((text) => ({
        id: randomUUID(), clusterId: randomUUID(), text, source: "manual", sourceNote: "", type: "discovery", stage: "awareness",
        region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary: true,
      })),
    };
    content.questions.forEach((question, index) => {
      if (index > 0) question.clusterId = content.questions[0].clusterId;
    });
    content.clusters[0].id = content.questions[0].clusterId;
    async function acceptSmall(requestedNetworkMode = "off", track = "model_api", channelId = channel.channelId) {
      const setId = randomUUID();
      await new PromptDao(db, brand).insertSet({
        id: setId, setId, version: 1, entityVersion: 1, region: "CN", language: "zh-CN", createdAt: time, content,
      });
      const preview = await previewMonitoringRun(db, owner, {
        action: "preview", brandId: brand, track, promptSetId: setId, repeats: 1,
        requestedNetworkMode, channelIds: [channelId], ceiling: track === "model_api" ? { currency: "CNY", upperMinor: 100 } : null,
      }, secret, clock);
      assert.equal(preview.error, undefined, preview.error);
      const accepted = await acceptMonitoringRun(db, owner, {
        action: "accept", ...preview.snapshot, token: preview.token, operationId: randomUUID(),
      }, secret, clock);
      assert.equal(accepted.error, undefined, accepted.error);
      return accepted;
    }
    const server = await listen((req, res, body) => {
      const text = String(body?.input ?? "");
      if (text.startsWith("SAFE")) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "unavailable" } }));
        return;
      }
      if (text.startsWith("LATE")) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload(text.slice(0, 4), {
        network_trigger: "not_triggered", citations: [{ url: "https://example.com/hold", title: "公开说明" }],
      }, { id: "resp-hold" })));
    });
    t.after(() => server.close());
    const port = createOfficialSamplingPort({
      baseUrl: server.baseUrl, apiKey, productEntry: "official-responses", priceTable, timeoutMs: 200,
    });
    const accepted = await acceptSmall();
    const unpriced = createOfficialSamplingPort({
      baseUrl: server.baseUrl, apiKey, productEntry: "official-responses",
      priceTable: { currency: "CNY", models: { "other-model": { inputMinorPerMillion: 1, outputMinorPerMillion: 1 } } },
      timeoutMs: 200,
    });
    const missingPrice = await executeMonitoringRun(db, owner, accepted.id, unpriced, clock);
    assert.equal(missingPrice.error, "NO_TRUSTED_CEILING");
    assert.equal(server.requests.length, 0);
    const denied = await executeMonitoringRun(db, outsider, accepted.id, port, clock);
    assert.equal(denied.error, "NOT_FOUND");
    assert.equal(server.requests.length, 0);
    const emailRun = await acceptSmall();
    const previousMail = process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK;
    process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = "false";
    try {
      await queryWithParameters(db, 'UPDATE "user" SET email_verified = ? WHERE id = ?', [db.kind === "sqlite" ? 0 : false, owner]);
      const unverified = await executeMonitoringRun(db, owner, emailRun.id, port, clock);
      assert.equal(unverified.error, "EMAIL_UNVERIFIED");
    } finally {
      if (previousMail === undefined) delete process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK;
      else process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = previousMail;
      await queryWithParameters(db, 'UPDATE "user" SET email_verified = ? WHERE id = ?', [db.kind === "sqlite" ? 1 : true, owner]);
    }
    assert.equal(server.requests.length, 0);
    const [beforeClaim] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM monitoring_attempt WHERE run_id = ?", [accepted.id]);
    assert.equal(Number(beforeClaim.count), 0);

    const crashedRun = await acceptSmall();
    await assert.rejects(() => executeMonitoringRun(db, owner, crashedRun.id, port, clock, { crashAfterClaim: true }), /official-claim-crash/);
    assert.equal(server.requests.length, 0);
    const claimed = await queryWithParameters(db, `SELECT a.disposition, a.cost_state AS "costState", s.question_id AS "questionId", s.status, r.state
      FROM monitoring_attempt a
      JOIN monitoring_slot s ON s.id = a.slot_id
      JOIN quota_reservation r ON r.id = s.reservation_id
      WHERE a.run_id = ?`, [crashedRun.id]);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].disposition, "pending");
    assert.equal(claimed[0].costState, "pending");
    assert.equal(claimed[0].status, "running");
    assert.equal(claimed[0].state, "reserved");
    const crashedQuestion = content.questions.find((question) => question.id === claimed[0].questionId).text;
    const lateClock = () => new Date(Date.parse(time) + 120_000).toISOString();
    const recovered = await executeMonitoringRun(db, owner, crashedRun.id, port, lateClock);
    assert.equal(recovered.error, undefined, recovered.error);
    assert.equal(server.requests.some((item) => item.body?.input === crashedQuestion), false);
    const reconciled = recovered.slots.find((slot) => slot.questionId === claimed[0].questionId);
    assert.equal(reconciled.status, "reconciliation_required");
    const [stillReserved] = await queryWithParameters(db, "SELECT state FROM quota_reservation WHERE id = ?", [reconciled.reservationId]);
    assert.equal(stillReserved.state, "reserved");

    const consumer = await recordCapability(db, operator, capability(operator, { kind: "consumer_ui" }), clock);
    assert.equal(consumer.status, "allowed");
    const consumerVerified = await recordCapability(db, operator, capability(operator, {
      kind: "consumer_ui", expectedVersion: 1, channelId: consumer.data.after.channelId,
      reason: "verification", status: "verified", verifiedAt: time, expiresAt: later,
    }), clock);
    assert.equal(consumerVerified.status, "allowed");
    const manual = await acceptSmall("off", "consumer_ui", consumerVerified.data.after.channelId);
    const protocolMark = server.requests.length;
    assert.equal((await executeMonitoringRun(db, owner, manual.id, port, clock)).error, "REAL_CHANNEL_CLOSED");

    const protocolDraft = {
      newSessionRequired: false, searchRequired: true, targetRegion: "CN", timezone: "Asia/Shanghai",
    };
    const created = await createSamplingProtocol(db, owner, { ...protocolDraft, operationId: randomUUID(), brandId: brand }, clock);
    assert.equal(created.error, undefined, created.error);
    const frozen = await freezeSamplingProtocol(db, owner, created.protocol.protocolId, { ...protocolDraft, operationId: randomUUID() }, clock);
    assert.equal(frozen.error, undefined, frozen.error);
    const incompatible = await acceptSmall();
    const linked = await pinSamplingProtocol(db, owner, incompatible.id, {
      protocolId: frozen.protocol.protocolId, version: frozen.protocol.version,
    }, clock);
    assert.equal(linked.error, undefined, linked.error);
    assert.equal((await executeMonitoringRun(db, owner, incompatible.id, port, clock)).error, "NETWORK_REQUIRED");
    assert.equal(server.requests.length, protocolMark);

    const providerPayload = payload("CONTROLS", { network_trigger: "not_triggered", citations: [] });
    let controlRequests = 0;
    const controlServer = await listen((_req, res) => {
      controlRequests += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(providerPayload));
    });
    t.after(() => controlServer.close());
    const controlPort = createOfficialSamplingPort({
      baseUrl: controlServer.baseUrl, apiKey, productEntry: "official-responses", priceTable, timeoutMs: 200,
    });
    const compatible = await acceptSmall("on");
    const pinned = await pinSamplingProtocol(db, owner, compatible.id, {
      protocolId: frozen.protocol.protocolId, version: frozen.protocol.version,
    }, clock);
    assert.equal(pinned.error, undefined, pinned.error);
    const compatibleResult = await executeMonitoringRun(db, owner, compatible.id, controlPort, clock);
    assert.equal(compatibleResult.status, "succeeded");
    assert.equal(controlRequests, 3);
    assert.equal(controlServer.requests.every(({ body }) => Object.keys(body).sort().join(",") === "input,model,store,tools"
      && body.tools[0].type === "web_search" && content.questions.some((question) => question.text === body.input)), true);

    async function changeDuringClaim(change, reply, recover = false) {
      const run = await acceptSmall();
      const { promise: started, resolve: exposeClaim } = Promise.withResolvers();
      const { promise: hold, resolve: releaseClaim } = Promise.withResolvers();
      const execution = executeMonitoringRun(db, owner, run.id, {
        ...controlPort,
        async sample(request) {
          exposeClaim();
          await hold;
          return reply(request);
        },
      }, clock);
      try {
        await started;
        const changed = await change(db, owner, run.id);
        assert.equal(changed.error, undefined, changed.error);
        const pending = changed.attempts.find((attempt) => attempt.disposition === "pending");
        assert.ok(pending);
        assert.equal((await reconcileMonitoringCost(db, owner, run.id, pending.id, 0, clock)).error, "OPERATION_CONFLICT");
        if (recover) {
          const recovered = await executeMonitoringRun(db, owner, run.id, officialSamplingPortFromEnv({}), lateClock);
          assert.equal(recovered.attempts[0].costState, "unknown");
          assert.equal(recovered.slots.find((slot) => slot.id === pending.slotId).status, "reconciliation_required");
        }
      } finally {
        releaseClaim();
      }
      return execution;
    }
    const pausedDuringClaim = await changeDuringClaim(pauseMonitoringRun, safeFailureOfficialSample);
    assert.equal(pausedDuringClaim.status, "paused");
    assert.equal(pausedDuringClaim.attempts.length, 1);
    assert.equal(pausedDuringClaim.attempts[0].late, 1);
    assert.equal((await executeMonitoringRun(db, owner, pausedDuringClaim.id, controlPort, clock)).replayed, true);
    assert.equal(controlRequests, 3);
    assert.equal((await continueMonitoringRun(db, owner, pausedDuringClaim.id)).status, "queued");
    const continued = await executeMonitoringRun(db, owner, pausedDuringClaim.id, controlPort, clock);
    assert.equal(continued.status, "succeeded");
    assert.equal(controlRequests, 6);

    const cancelledDuringClaim = await changeDuringClaim(cancelMonitoringRun, controlPort.sample);
    assert.equal(cancelledDuringClaim.status, "cancelled");
    assert.equal(cancelledDuringClaim.attempts.length, 1);
    assert.equal(cancelledDuringClaim.attempts[0].disposition, "late");
    assert.equal(cancelledDuringClaim.attempts[0].actualMinor, 11);
    assert.equal(parseOfficialReceipt(cancelledDuringClaim.attempts[0].receipt).responseId, "resp-CONTROLS");
    assert.equal(cancelledDuringClaim.slots.every((slot) => slot.adoptedAttemptId === null), true);
    assert.equal(controlRequests, 7);

    const recoveredWhilePaused = await changeDuringClaim(pauseMonitoringRun, controlPort.sample, true);
    assert.equal(recoveredWhilePaused.status, "paused");
    assert.equal(recoveredWhilePaused.attempts.length, 1);
    assert.equal(recoveredWhilePaused.attempts[0].disposition, "adopted");
    assert.equal(recoveredWhilePaused.attempts[0].actualMinor, 11);
    assert.equal(recoveredWhilePaused.attempts[0].late, 1);
    assert.equal(controlRequests, 8);

    const live = await acceptSmall();
    let release;
    let opened;
    const hold = new Promise((resolve) => { release = resolve; });
    const gate = new Promise((resolve) => { opened = resolve; });
    let blocked = true;
    let blockedText = "";
    let blockedSamples = 0;
    const blocking = {
      ...port,
      async sample(input) {
        if (blocked) {
          blocked = false;
          blockedText = input.questionText;
          opened();
          await hold;
        }
        if (input.questionText === blockedText) blockedSamples += 1;
        return port.sample(input);
      },
    };
    const liveMark = server.requests.length;
    const first = executeMonitoringRun(db, owner, live.id, blocking, clock);
    await gate;
    const second = await executeMonitoringRun(db, owner, live.id, blocking, clock);
    release();
    const finished = await first;
    assert.equal(finished.error, undefined, finished.error);
    assert.equal(second.error, undefined, second.error);
    assert.equal(blockedSamples, 1, JSON.stringify(server.requests.slice(liveMark).map((item) => item.body?.input)));
    const succeeded = finished.slots.filter((slot) => slot.status === "succeeded");
    assert.ok(succeeded.length >= 1);
    const adopted = finished.attempts.find((attempt) => attempt.disposition === "adopted" && attempt.rawText);
    assert.ok(adopted.receipt);
    const receipt = JSON.parse(adopted.receipt);
    assert.equal(receipt.responseId, "resp-hold");
    assert.equal(receipt.citationSetState, "complete");
    assert.equal(receipt.citations[0].url, "https://example.com/hold");
    assert.equal(receipt.networkTrigger, "not_triggered");
    assert.equal(server.requests.every((item) => item.body.model === "fixture-model" && item.body.store === false && !("brand" in item.body)), true);

    const retried = await acceptSmall();
    const mark = server.requests.length;
    const once = await executeMonitoringRun(db, owner, retried.id, port, clock);
    assert.equal(once.error, undefined, once.error);
    const again = await executeMonitoringRun(db, owner, retried.id, port, clock);
    assert.equal(again.error, undefined, again.error);
    const byInput = (prefix) => server.requests.slice(mark).filter((item) => String(item.body?.input ?? "").startsWith(prefix));
    assert.equal(byInput("SAFE").length, 2);
    const finalRetry = await executeMonitoringRun(db, owner, retried.id, port, clock);
    assert.equal(finalRetry.error, undefined, finalRetry.error);
    assert.equal(byInput("SAFE").length, 3);
    assert.equal((await executeMonitoringRun(db, owner, retried.id, port, clock)).replayed, true);
    assert.equal(byInput("SAFE").length, 3);
    assert.equal(byInput("LATE").length, 1);
    const safeSlot = again.slots.find((slot) => content.questions.find((question) => question.id === slot.questionId)?.text.startsWith("SAFE"));
    const lateSlot = again.slots.find((slot) => content.questions.find((question) => question.id === slot.questionId)?.text.startsWith("LATE"));
    assert.equal(safeSlot.status, "queued");
    assert.equal(finalRetry.slots.find((slot) => slot.id === safeSlot.id).status, "failed");
    assert.equal(lateSlot.status, "reconciliation_required");
    const [lateReservation] = await queryWithParameters(db, "SELECT state FROM quota_reservation WHERE id = ?", [lateSlot.reservationId]);
    assert.equal(lateReservation.state, "reserved");

    const tight = await acceptSmall();
    const raced = await acceptSmall();
    const closedRun = await acceptSmall();
    const sampleCounts = new Map();
    const racing = {
      ...port,
      async sample(input) {
        sampleCounts.set(input.questionText, (sampleCounts.get(input.questionText) ?? 0) + 1);
        return port.sample(input);
      },
    };
    const [left, right] = await Promise.all([
      executeMonitoringRun(db, owner, raced.id, racing, clock),
      executeMonitoringRun(db, owner, raced.id, racing, clock),
    ]);
    assert.equal(left.error, undefined, left.error);
    assert.equal(right.error, undefined, right.error);
    for (const question of content.questions) {
      const seen = sampleCounts.get(question.text) ?? 0;
      if (question.text.startsWith("SAFE")) assert.ok(seen === 1 || seen === 2, String(seen));
      else assert.equal(seen, 1, question.text);
    }

    assert.equal((await updateQuota(db, operator, {
      action: "set", actorId: operator, brandId: brand, kind: "sampling", operationId: randomUUID(),
      expectedVersion: 1, reason: "budget-decrease", countLimit: 40, budgetMinor: 0, currency: "CNY",
      expiresAt: "2026-12-19T06:00:00.000Z",
    }, clock)).status, "allowed");
    const tightMark = server.requests.length;
    const paused = await executeMonitoringRun(db, owner, tight.id, port, clock);
    assert.equal(paused.error, undefined, paused.error);
    assert.equal(paused.pausedForBudget, true);
    assert.equal(server.requests.length, tightMark);
    const [tightAttempts] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM monitoring_attempt WHERE run_id = ?", [tight.id]);
    assert.equal(Number(tightAttempts.count), 0);
    assert.equal(paused.slots.every((slot) => slot.status === "paused"), true);
    const retryPaused = await executeMonitoringRun(db, owner, raced.id, port, clock);
    assert.equal(retryPaused.pausedForBudget, true);
    assert.equal(server.requests.length, tightMark);

    const recorded = await recordCapability(db, operator, capability(operator, {
      expectedVersion: 2, channelId: channel.channelId, reason: "significant-change", status: "degraded",
      verifiedAt: null, expiresAt: null, publicVisible: 0,
    }), clock);
    assert.equal(recorded.status, "allowed");
    const degradedMark = server.requests.length;
    const degraded = await executeMonitoringRun(db, owner, closedRun.id, port, clock);
    assert.equal(degraded.error, "CHANNEL_UNVERIFIED");
    assert.equal(server.requests.length, degradedMark);
    const [degradedAttempts] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM monitoring_attempt WHERE run_id = ?", [closedRun.id]);
    assert.equal(Number(degradedAttempts.count), 0);
  });
}
