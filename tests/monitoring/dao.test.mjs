import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { recordCapability } from "../../src/features/capabilities/commands.ts";
import { changeMaintenanceGrant } from "../../src/features/maintenance/core.ts";
import { acceptMonitoringRun, previewMonitoringRun, readMonitoringRun } from "../../src/features/monitoring/commands.ts";
import { previewRequestSchema } from "../../src/features/monitoring/contracts.ts";
import { previewToken } from "../../src/features/monitoring/rules.ts";
import { MonitoringDao } from "../../src/features/monitoring/dao.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import { updateQuota } from "../../src/features/quotas/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-19T06:00:00.000Z";
const later = "2026-11-19T06:20:00.000Z";
const secret = "monitoring-test-secret-monitoring-test";
const clock = () => time;
const fields = {
  name: "Synthetic", description: "Synthetic brand for run acceptance", website: "", aliases: [],
  region: "CN", language: "zh-CN", competitors: [], questions: [],
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json", "utf8"));
  return journal.entries.at(-2).tag;
}

async function account(db, verified = false) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Synthetic M0 run", `${id}@example.invalid`, verified ? (db.kind === "sqlite" ? 1 : true) : (db.kind === "sqlite" ? 0 : false)]);
  return id;
}

function capability(actorId, overrides = {}) {
  return {
    action: "record", actorId, operationId: randomUUID(), expectedVersion: null, channelId: null,
    vendorId: "acme-ai", kind: "model_api", reason: "initial-record", status: "candidate",
    displayName: "Acme API", productEntry: "chat.completions", mode: "official-api", modelVersion: "unknown",
    availability: "synthetic fixture", searchRequired: 0, citationCapability: "partial",
    regionTarget: "CN", regionActual: "unknown", limitsSummary: "No production traffic",
    sopSummary: "Human SOP without secrets", verifiedAt: null, expiresAt: null, publicVisible: 0,
    ...overrides,
  };
}

test("monitoring input rejects repeats outside 1–3 and extra fields", () => {
  const command = {
    action: "preview", brandId: randomUUID(), track: "model_api", promptSetId: randomUUID(), repeats: 1,
    requestedNetworkMode: "unknown", channelIds: [randomUUID()], ceiling: { currency: "CNY", upperMinor: 10 },
  };
  assert.equal(previewRequestSchema.safeParse(command).success, true);
  for (const extra of [{ repeats: 0 }, { repeats: 4 }, { ceiling: { currency: "CNY", upperMinor: -1 } }, { note: "secret" }]) {
    assert.equal(previewRequestSchema.safeParse({ ...command, ...extra }).success, false);
  }
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: queued run registration is idempotent and keeps the two tracks apart`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });
    const ddl = await testDatabase(kind, { ddl: true });
    try { assert.deepEqual(await structure(db), await structure(ddl.connection)); }
    finally { await ddl.cleanup(); }

    const [owner, outsider, operator] = await Promise.all([account(db, true), account(db), account(db)]);
    const brand = randomUUID();
    const otherBrand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);
    await brands.insertBrand(outsider, otherBrand, time);
    await brands.insertVersion(otherBrand, 1, fields, time);
    for (const permission of ["capabilities.manage", "quotas.manage"]) {
      assert.equal((await changeMaintenanceGrant(db, {
        action: "grant", operatorId: operator, userId: operator, permission, reason: "initial-setup",
      })).status, "allowed");
    }
    const api = (await recordCapability(db, operator, capability(operator), clock)).data.after;
    const verified = (await recordCapability(db, operator, capability(operator, {
      expectedVersion: 1, channelId: api.channelId, reason: "verification", status: "verified", verifiedAt: time, publicVisible: 0,
    }), clock)).data.after;
    const consumer = (await recordCapability(db, operator, capability(operator, {
      kind: "consumer_ui", displayName: "Acme chat", productEntry: "consumer-app", mode: "consumer-ui",
    }), clock)).data.after;
    const verifiedConsumer = (await recordCapability(db, operator, capability(operator, {
      kind: "consumer_ui", expectedVersion: 1, channelId: consumer.channelId, reason: "verification",
      status: "verified", verifiedAt: time, publicVisible: 0,
    }), clock)).data.after;
    assert.equal((await updateQuota(db, operator, {
      action: "set", actorId: operator, brandId: brand, kind: "sampling", operationId: randomUUID(),
      expectedVersion: null, reason: "pilot-approval", countLimit: 4, budgetMinor: 1000, currency: "CNY",
      expiresAt: "2026-12-19T06:00:00.000Z",
    }, clock)).status, "allowed");

    const clusterId = randomUUID();
    const questions = [
      ["这个品类里，大家通常会比较哪些条件？", true, "discovery"],
      ["日常使用时，最先要确认的使用场景是什么？", true, "scenario"],
      ["预算有限时，怎样判断一个选择是否合适？", true, "constraint"],
      ["和甲品牌相比，这个方案适合哪些限制？", false, "comparison"],
    ].map(([text, primary, type]) => ({
      id: randomUUID(), clusterId, text, source: "manual", sourceNote: "", type, stage: "awareness",
      region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary,
    }));
    const setId = randomUUID();
    await new PromptDao(db, brand).insertSet({
      id: setId, setId, version: 1, entityVersion: 1, region: "CN", language: "zh-CN", createdAt: time,
      content: { clusters: [{ id: clusterId, audience: "购买者", intent: "比较使用条件", primaryPage: "", conversionAction: "" }], questions },
    });

    const base = {
      brandId: brand, track: "model_api", promptSetId: setId, repeats: 1, requestedNetworkMode: "unknown",
      channelIds: [verified.channelId], ceiling: { currency: "CNY", upperMinor: 10 },
    };
    assert.equal((await previewMonitoringRun(db, owner, { action: "preview", ...base, ceiling: null }, secret, clock)).error, "NO_TRUSTED_CEILING");
    assert.equal((await previewMonitoringRun(db, owner, { action: "preview", ...base, brandId: otherBrand }, secret, clock)).error, "NOT_FOUND");
    const stale = await previewMonitoringRun(db, owner, { action: "preview", ...base }, secret, clock);
    await recordCapability(db, operator, capability(operator, {
      expectedVersion: verified.version, channelId: verified.channelId, reason: "verification", status: "verified",
      verifiedAt: time, publicVisible: 0, availability: "synthetic fixture changed",
    }), clock);
    const operationId = randomUUID();
    assert.equal((await acceptMonitoringRun(db, owner, {
      action: "accept", ...stale.snapshot, token: stale.token, operationId,
    }, secret, clock)).error, "VERSION_CONFLICT");

    const preview = await previewMonitoringRun(db, owner, { action: "preview", ...base }, secret, clock);
    assert.equal(preview.snapshot.questionCount, 4);
    assert.equal(preview.snapshot.naturalCount, 3);
    assert.equal(preview.snapshot.customerPayableMinor, undefined);
    const acceptBody = { action: "accept", ...preview.snapshot, token: preview.token, operationId };
    const accepted = await Promise.all([0, 1, 2].map(() => acceptMonitoringRun(db, owner, acceptBody, secret, clock)));
    assert.equal(accepted.filter((item) => item.replayed === false).length, 1);
    assert.equal(accepted.filter((item) => item.replayed === true).length, 2);
    const run = accepted.find((item) => item.replayed === false);
    assert.equal(run.slotCount, 4);
    assert.equal(run.slots.length, 4);
    assert.equal(run.slots.filter((slot) => slot.natural === 1).length, 3);
    assert.equal(run.customerPayableMinor, 0);
    assert.equal(run.upperMinor, 10);
    assert.equal(run.estimateHighMinor, 40);
    assert.equal(new Set(accepted.map((item) => item.id)).size, 1);
    assert.equal(new Set(run.slots.map((slot) => slot.reservationId)).size, 4);
    const [reserved] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM quota_reservation WHERE brand_id = ?", [brand]);
    assert.equal(Number(reserved.count), 4);
    const repeated = await acceptMonitoringRun(db, owner, acceptBody, secret, () => later);
    assert.equal(repeated.replayed, true);
    assert.equal(repeated.id, run.id);

    const changedSnapshot = { ...preview.snapshot, repeats: 2 };
    assert.equal((await acceptMonitoringRun(db, owner, {
      action: "accept", ...changedSnapshot, token: previewToken(changedSnapshot, secret), operationId,
    }, secret, clock)).error, "OPERATION_CONFLICT");
    assert.equal((await acceptMonitoringRun(db, owner, {
      action: "accept", ...preview.snapshot, token: preview.token, operationId: randomUUID(),
    }, secret, () => later)).error, "PREVIEW_EXPIRED");
    assert.equal((await acceptMonitoringRun(db, owner, {
      action: "accept", ...preview.snapshot, token: preview.token, operationId: randomUUID(),
    }, secret, clock)).error, "QUOTA_INSUFFICIENT");

    const manualPreview = await previewMonitoringRun(db, owner, {
      action: "preview", brandId: brand, track: "consumer_ui", promptSetId: setId, repeats: 1,
      requestedNetworkMode: "off", channelIds: [verifiedConsumer.channelId], ceiling: null,
    }, secret, clock);
    const manual = await acceptMonitoringRun(db, owner, {
      action: "accept", ...manualPreview.snapshot, token: manualPreview.token, operationId: randomUUID(),
    }, secret, clock);
    assert.equal(manual.track, "consumer_ui");
    assert.equal(manual.currency, null);
    assert.equal(manual.slots.every((slot) => slot.reservationId === null), true);
    assert.equal(manual.samplingComplete, 0);
    const [stillReserved] = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM quota_reservation WHERE brand_id = ?", [brand]);
    assert.equal(Number(stillReserved.count), 4);
    const read = await readMonitoringRun(db, owner, manual.id);
    assert.equal(read.questionCount, 4);
    assert.equal((await readMonitoringRun(db, outsider, manual.id)).error, "NOT_FOUND");

    await queryWithParameters(db, 'UPDATE "user" SET email_verified = ? WHERE id = ?', [db.kind === "sqlite" ? 0 : false, owner]);
    const previousEmailMock = process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK;
    process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = "false";
    try {
      assert.equal((await previewMonitoringRun(db, owner, { action: "preview", ...base }, secret, clock)).error, "EMAIL_UNVERIFIED");
    } finally {
      if (previousEmailMock === undefined) delete process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK;
      else process.env.GEO_AUTH_EMAIL_VERIFIED_MOCK = previousEmailMock;
    }
    const manualAgain = await previewMonitoringRun(db, owner, {
      action: "preview", brandId: brand, track: "consumer_ui", promptSetId: setId, repeats: 2,
      requestedNetworkMode: "off", channelIds: [verifiedConsumer.channelId], ceiling: null,
    }, secret, clock);
    assert.equal(manualAgain.error, undefined);

    const unrelated = Array.from({ length: 200 }, () => randomUUID());
    await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
      VALUES ${unrelated.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`, unrelated.flatMap((id) => [id, outsider, time]));
    await queryWithParameters(db, `INSERT INTO monitoring_run
      (id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version, repeat_count,
       question_count, natural_count, channel_count, slot_count, region, language, requested_network_mode,
       customer_payable_minor, status, sampling_complete, created_at)
      VALUES ${unrelated.map(() => "(?, ?, ?, ?, ?, 'consumer_ui', ?, 1, 1, 4, 3, 1, 4, 'CN', 'zh-CN', 'off', 0, 'queued', 0, ?)").join(", ")}`,
    unrelated.flatMap((id) => [randomUUID(), id, outsider, randomUUID(), "a".repeat(64), setId, time]));
    if (db.kind === "postgresql") await db.query("ANALYZE monitoring_run");
    const listSql = "SELECT id FROM monitoring_run WHERE brand_id = ? ORDER BY created_at DESC, id DESC LIMIT ?";
    const plan = JSON.stringify(await queryWithParameters(db, (db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ") + listSql, [brand, 10]));
    assert.match(plan, /monitoring_run_brand_recent_idx/);
    const listed = await new MonitoringDao(db).recent(brand, 10);
    assert.equal(listed.length, 2);
    assert.equal(listed.every((item) => item.brandId === brand), true);
  });
}
