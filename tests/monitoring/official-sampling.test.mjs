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
import { executeMonitoringRun } from "../../src/features/monitoring/execution.ts";
import { createOfficialSamplingPort, officialSamplingPortFromEnv } from "../../src/features/monitoring/official-port.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import { updateQuota } from "../../src/features/quotas/commands.ts";
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
  return { owner, brand, channel };
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
        const seen = (counts.get(code) ?? 0) + 1;
        counts.set(code, seen);
        if (seen % 2 === 1) {
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
    assert.equal(byCode("Q07").length, 8);
    assert.equal(byCode("Q08").length, 2);
    assert.equal(errors.some((line) => line.includes(apiKey)), false);
    const codeByQuestion = new Map(content.questions.map((question) => [question.id, question.text.slice(0, 3)]));
    const samplesFor = (code) => seen.filter((item) => codeByQuestion.get(item.questionId) === code).map((item) => item.sample);
    assert.equal(samplesFor("Q01").every((sample) => sample.disposition === "adopted" && sample.citationSetState === "complete" && sample.citations.length === 1 && sample.networkTrigger === "triggered" && sample.actualMinor === 11), true);
    assert.equal(samplesFor("Q02").every((sample) => sample.disposition === "adopted" && sample.citationSetState === "complete" && sample.citations.length === 0), true);
    assert.equal(samplesFor("Q03").every((sample) => sample.citationSetState === "missing" && sample.disposition === "adopted"), true);
    assert.equal(samplesFor("Q04").every((sample) => sample.citationSetState === "unsupported" && sample.disposition === "adopted"), true);
    assert.equal(samplesFor("Q05").every((sample) => sample.networkTrigger === "unknown" && sample.citationSetState === "complete" && sample.disposition === "adopted"), true);
    assert.equal(samplesFor("Q06").every((sample) => sample.disposition === "adopted" && sample.actualMinor === 11), true);
    assert.equal(samplesFor("Q07").every((sample) => sample.disposition === "safe_failure" && sample.rawText === null), true);
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
    for (const code of ["Q08", "Q09", "Q10"]) assert.equal(withCode(code).every((slot) => slot.status === "reconciliation_required"), true, code);
    assert.equal(withCode("Q07").every((slot) => slot.status === "queued"), true);
    const attempts = await queryWithParameters(db, "SELECT slot_id AS \"slotId\", transport, synthetic, disposition, actual_minor AS \"actualMinor\", cost_state AS \"costState\", raw_text AS \"rawText\" FROM monitoring_attempt WHERE run_id = ? AND kind = 'sampling'", [accepted.id]);
    assert.equal(attempts.every((row) => row.transport === "official_api" && Number(row.synthetic) === 0), true);
    assert.equal(attempts.filter((row) => slotCode.get(row.slotId) === "Q01").every((row) => Number(row.actualMinor) === 11 && row.costState === "known"), true);
    assert.equal(attempts.filter((row) => slotCode.get(row.slotId) === "Q08").every((row) => row.actualMinor === null && row.costState === "unknown"), true);
    assert.equal(attempts.filter((row) => slotCode.get(row.slotId) === "Q07").every((row) => Number(row.actualMinor) === 0 && row.rawText === null), true);
    const networks = await queryWithParameters(db, "SELECT actual_network AS \"actualNetwork\", qualifies_required_search AS \"qualifies\" FROM sampling_answer_network WHERE brand_id = ?", [brand]);
    assert.equal(networks.filter((row) => row.actualNetwork === "unknown").length, 4);
    assert.equal(networks.filter((row) => row.actualNetwork === "unknown").every((row) => Number(row.qualifies) === 0), true);
    assert.equal(networks.filter((row) => row.actualNetwork === "true").length, 14);
    const reserved = await queryWithParameters(db, `SELECT s.id FROM monitoring_slot s JOIN quota_reservation r ON r.id = s.reservation_id
      WHERE s.run_id = ? AND s.status = 'reconciliation_required' AND r.state = 'reserved'`, [accepted.id]);
    assert.equal(reserved.length, 6);
  });
}
