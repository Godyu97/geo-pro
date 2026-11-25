import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import {
  listDemoObservations,
  recordDemoObservation,
} from "../../src/features/monitoring/demo-commands.ts";
import {
  createDemoObservationSchema,
  demoErrors,
} from "../../src/features/monitoring/demo-contracts.ts";
import { DemoObservationDao, demosForOwnerQuery } from "../../src/features/monitoring/demo-dao.ts";
import { loadSnapshotComparisons } from "../../src/features/reports/snapshot-comparisons.ts";
import { saveComparisonFixture } from "../reports/saved-observations.mjs";
import { buildSnapshotDocument } from "../../src/features/reports/snapshot.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { memoryCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const clock = () => time;
const question = "隔离演示题：北岸泵的演示回答能否进入真实分母？";
const answer = "这是演示回答，不能进入真实统计。";
const naturalFiles = [
  "src/features/evidence/dao.ts",
  "src/features/evidence/overview-commands.ts",
  "src/features/evidence/metrics.ts",
  "src/features/reports/dao.ts",
  "src/features/reports/commands.ts",
  "src/features/reports/snapshot.ts",
  "src/features/reports/snapshot-comparisons.ts",
  "src/features/reports/rules.ts",
  "src/features/functional-mock/apply-retest.ts",
];
const fields = {
  name: "乙品牌", description: "Synthetic brand for demo isolation", website: "https://yi.example.com",
  aliases: ["乙"], region: "CN", language: "zh-CN", competitors: [], questions: [],
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json", "utf8"));
  return journal.entries.at(-2).tag;
}

function watch(db) {
  const captured = [];
  const wrap = (target) => ({
    kind: target.kind,
    query(sql, values) {
      captured.push({ sql, values });
      return target.query(sql, values);
    },
    transaction: target.transaction
      ? (work) => target.transaction((tx) => work(wrap(tx)))
      : undefined,
    savepoint: target.savepoint
      ? (work) => target.savepoint((inner) => work(wrap(inner)))
      : undefined,
  });
  return { captured, connection: wrap(db) };
}

function writes(captured, table) {
  return captured.filter((item) => new RegExp(`^\\s*(insert|update|delete)[\\s\\S]*\\b${table}\\b`, "i").test(item.sql));
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Demo owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function countBy(db, table, column, value) {
  const [row] = await queryWithParameters(db, `SELECT count(*) AS "total" FROM ${table} WHERE ${column} = ?`, [value]);
  return Number(row.total);
}

function rates(view) {
  return {
    sampleCount: view.sampleCount,
    eligibleCount: view.eligibleCount,
    sampleIds: view.sampleIds,
    mentioned: view.metrics.mentioned.pooled,
    recommended: view.metrics.recommended.pooled,
    officialSiteCited: view.metrics.officialSiteCited.pooled,
  };
}

function demoInput(brandId, operationId, answerText = answer) {
  return { operationId, brandId, questionText: question, answerText };
}

async function realSnapshot(db, owner, brandId, windows) {
  const scope = { track: "model_api", timezone: "Asia/Shanghai", entityVersion: 1 };
  const metrics = await loadSnapshotComparisons(db, owner, brandId, windows, scope);
  return buildSnapshotDocument({
    reportId: "5160d7dc-1cae-4d26-8ce4-fd2b886c8192",
    brandId,
    brandName: "乙品牌",
    entityVersion: 1,
    timezone: scope.timezone,
    locale: "zh-CN",
    intent: "diagnostic",
    loopCompleted: false,
    metrics,
    windows: {
      before: { start: windows.before.start, endExclusive: windows.before.endExclusive },
      after: { start: windows.after.start, endExclusive: windows.after.endExclusive },
    },
    publication: null,
    createdAt: time,
    cost: { status: "not_applicable", reason: "no_sampling_cost" },
    labor: { status: "not_applicable", reason: "unrecorded" },
  });
}

test("demo input stays out of real answers and carries a visible demo flag", async () => {
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const operationId = "4160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const valid = demoInput(brandId, operationId);
  assert.equal(createDemoObservationSchema.safeParse(valid).success, true);
  assert.equal(createDemoObservationSchema.safeParse({ ...valid, copyToAnswerObservation: true }).success, false);
  assert.equal(createDemoObservationSchema.safeParse({ ...valid, copyToRetest: true }).success, false);
  assert.equal(createDemoObservationSchema.safeParse({ ...valid, copyToReport: true }).success, false);
  assert.equal(createDemoObservationSchema.safeParse({ ...valid, is_demo: false }).success, false);
  assert.equal(demoErrors.NOT_FOUND, 404);
  assert.equal(demoErrors.COPY_REJECTED, 409);
  assert.equal(safeReturnTo("/dashboard/monitoring/demo"), "/dashboard/monitoring/demo");
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url), "utf8"));
  assert.match(zhCN.demoObservations.demoBadge, /演示数据/);
  assert.match(zhCN.demoObservations.description, /演示数据/);
  assert.match(zhCN.demoObservations.notVerified, /不是已验证的客户结果/);
  assert.match(zhCN.demoObservations.fixtureNote, /推荐率/);
  assert.match(zhCN.demoObservations.fixtureNote, /排名/);
  assert.match(zhCN.demoObservations.fixtureNote, /提升比例/);
  assert.match(en.demoObservations.demoBadge, /Demo data/i);
  assert.match(en.demoObservations.description, /demo data/i);
  assert.match(en.demoObservations.notVerified, /not a verified customer result/i);
  assert.match(en.demoObservations.fixtureNote, /recommendation rate/i);
  assert.equal(JSON.stringify(zhCN.demoObservations).includes(question), false);
  assert.equal(JSON.stringify(en.demoObservations).includes(answer), false);
  const api = await readFile(new URL("../../src/features/monitoring/demo-api.ts", import.meta.url), "utf8");
  assert.match(api, /status: demoErrors\[code\]/);
  const denied = Response.json({ error: { code: "NOT_FOUND", message: zhCN.demoObservations.NOT_FOUND } }, { status: demoErrors.NOT_FOUND });
  assert.equal(denied.status, 404);
  const body = await denied.json();
  assert.equal(JSON.stringify(body).includes(question), false);
  assert.equal(JSON.stringify(body).includes(answer), false);
  const command = await readFile(new URL("../../src/features/monitoring/demo-commands.ts", import.meta.url), "utf8");
  const dao = await readFile(new URL("../../src/features/monitoring/demo-dao.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../../src/features/monitoring/demo-page.tsx", import.meta.url), "utf8");
  const snapshot = await readFile(new URL("../../src/features/reports/snapshot.ts", import.meta.url), "utf8");
  assert.equal(command.includes("copyToAnswerObservation"), true);
  assert.equal(command.includes("copyToRetest"), true);
  assert.equal(command.includes("copyToReport"), true);
  assert.equal(/insert\s+into\s+answer_observation/i.test(command), false);
  assert.equal(/from\s+answer_observation/i.test(command), false);
  assert.equal(command.includes("report_snapshot"), false);
  assert.equal(command.includes("report_retest"), false);
  assert.equal(command.includes("monitoring_slot"), false);
  assert.equal(command.includes("quota_"), false);
  assert.equal(command.includes("createAiResponse"), false);
  assert.match(dao, /INSERT INTO demo_observation/);
  assert.equal(/answer_observation/i.test(dao), false);
  assert.equal(page.includes("demoBadge") && page.includes("notVerified"), true);
  assert.match(snapshot, /is_demo:\s*false/);
  assert.equal(snapshot.includes("demo_observation"), false);
  for (const file of naturalFiles) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("demo_observation"), false, file);
  }
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: demo rows stay out of real answers and report samples`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });

    const [owner, outsider] = await Promise.all([account(db), account(db)]);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);
    const natural = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "这个品类里该怎么选？",
      answerText: "可以考虑乙品牌。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://demo/natural",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "true",
      recommended: "true",
      officialSiteCited: "false",
    }, clock);
    assert.equal(natural.error, undefined);
    const reportWindows = await saveComparisonFixture(db, owner, brand);
    const scope = { brandId: brand, sourceMode: "consumer_ui" };
    const before = await readEvidenceOverview(db, owner, scope, memoryCache());
    assert.equal("error" in before, false);
    assert.ok(before.sampleCount >= 1);
    const answersBefore = await countBy(db, "answer_observation", "brand_id", brand);
    const snapshotsBefore = await countBy(db, "report_snapshot", "brand_id", brand);
    const retestsBefore = await countBy(db, "report_retest", "brand_id", brand);
    const frozen = await realSnapshot(db, owner, brand, reportWindows);
    assert.equal(frozen.is_demo, false);
    assert.equal(frozen.comparisons.recommendation_rate.before, 0);
    assert.equal(frozen.comparisons.recommendation_rate.before_sample_count, 3);

    const operationId = randomUUID();
    const saved = await recordDemoObservation(db, owner, demoInput(brand, operationId), clock);
    assert.equal(saved.error, undefined);
    assert.equal(saved.observation.is_demo, true);
    assert.equal(await countBy(db, "answer_observation", "brand_id", brand), answersBefore);
    assert.equal(await countBy(db, "report_snapshot", "brand_id", brand), snapshotsBefore);
    assert.equal(await countBy(db, "report_retest", "brand_id", brand), retestsBefore);
    assert.equal(await countBy(db, "demo_observation", "brand_id", brand), 1);
    const after = await readEvidenceOverview(db, owner, scope, memoryCache());
    assert.deepEqual(rates(after), rates(before));
    assert.equal(after.answers.some((item) => item.questionText === question), false);
    const stillFrozen = await realSnapshot(db, owner, brand, {
      ...reportWindows,
      after: { ...reportWindows.after, samples: [...reportWindows.after.samples, { observationId: saved.observation.id }] },
    });
    const recommendation = stillFrozen.comparisons.recommendation_rate;
    assert.equal(stillFrozen.is_demo, false);
    assert.equal(recommendation.before, frozen.comparisons.recommendation_rate.before);
    assert.equal(recommendation.after, frozen.comparisons.recommendation_rate.after);
    assert.equal(recommendation.after_sample_count, 3);
    assert.equal(recommendation.unavailable_observation_count.after, 1);
    assert.equal(JSON.stringify(stillFrozen).includes(saved.observation.id), false);

    const replay = await recordDemoObservation(db, owner, demoInput(brand, operationId), clock);
    assert.equal(replay.observation.id, saved.observation.id);
    assert.equal(await countBy(db, "demo_observation", "brand_id", brand), 1);
    const conflict = await recordDemoObservation(db, owner, demoInput(brand, operationId, "另一条演示回答"), clock);
    assert.equal(conflict.error, "OPERATION_CONFLICT");
    assert.equal(await countBy(db, "answer_observation", "brand_id", brand), answersBefore);

    const watched = watch(db);
    const second = await recordDemoObservation(watched.connection, owner, demoInput(brand, randomUUID(), "第二条演示回答"), clock);
    assert.equal(second.error, undefined);
    assert.equal(writes(watched.captured, "demo_observation").length, 1);
    assert.equal(writes(watched.captured, "answer_observation").length, 0);
    assert.equal(writes(watched.captured, "report_snapshot").length, 0);
    assert.equal(writes(watched.captured, "report_retest").length, 0);
    assert.equal(writes(watched.captured, "monitoring_slot").length, 0);
    assert.equal(writes(watched.captured, "quota_reservation").length, 0);

    const beforeCopy = await countBy(db, "demo_observation", "brand_id", brand);
    for (const flag of ["copyToAnswerObservation", "copyToRetest", "copyToReport"]) {
      const refused = await recordDemoObservation(db, owner, { ...demoInput(brand, randomUUID()), [flag]: true }, clock);
      assert.equal(refused.error, "COPY_REJECTED");
    }
    assert.equal(await countBy(db, "demo_observation", "brand_id", brand), beforeCopy);
    assert.equal(await countBy(db, "answer_observation", "brand_id", brand), answersBefore);
    assert.equal(await countBy(db, "report_snapshot", "brand_id", brand), snapshotsBefore);
    assert.equal(await countBy(db, "report_retest", "brand_id", brand), retestsBefore);

    const hidden = await listDemoObservations(db, outsider, brand);
    assert.equal(hidden.error, "NOT_FOUND");
    assert.equal(JSON.stringify(hidden).includes(question), false);
    assert.equal(JSON.stringify(hidden).includes(answer), false);
    const visible = await listDemoObservations(db, owner, brand);
    assert.equal(visible.is_demo, true);
    assert.equal(visible.observations.every((item) => item.is_demo === true), true);
    assert.equal(visible.observations.some((item) => item.questionText === question && item.answerText === answer), true);
    const overviewWatch = watch(db);
    const still = await readEvidenceOverview(overviewWatch.connection, owner, scope, memoryCache());
    assert.deepEqual(rates(still), rates(before));
    assert.equal(overviewWatch.captured.some((item) => item.sql.includes("demo_observation")), false);
    assert.equal(overviewWatch.captured.some((item) => item.sql.includes("answer_observation")), true);

    await assert.rejects(
      () => queryWithParameters(db, `UPDATE demo_observation SET is_demo = 0 WHERE id = ?`, [saved.observation.id]),
      /CHECK|check constraint/i,
    );
    await assert.rejects(
      () => db.transaction(async (tx) => {
        await new DemoObservationDao(tx).insert({
          id: randomUUID(),
          brandId: brand,
          ownerId: owner,
          questionText: question,
          answerText: answer,
          isDemo: 1,
          operationId: randomUUID(),
          createdAt: time,
        });
        throw new Error("rollback-fixture");
      }),
      /rollback-fixture/,
    );
    assert.equal(await countBy(db, "demo_observation", "brand_id", brand), beforeCopy);

    const shape = await structure(db);
    assert.match(JSON.stringify(shape), /demo_observation/);
    assert.match(JSON.stringify(shape), /is_demo/);

    const otherBrand = randomUUID();
    await brands.insertBrand(outsider, otherBrand, time);
    const extraIds = Array.from({ length: 200 }, () => randomUUID());
    for (let offset = 0; offset < extraIds.length; offset += 100) {
      const chunk = extraIds.slice(offset, offset + 100);
      await queryWithParameters(
        db,
        `INSERT INTO demo_observation (
          id, brand_id, owner_id, question_text, answer_text, is_demo, operation_id, created_at
        ) VALUES ${chunk.map(() => "(?, ?, ?, 'q', 'a', 1, ?, ?)").join(", ")}`,
        chunk.flatMap((id) => [id, otherBrand, outsider, id, time]),
      );
    }
    if (db.kind === "postgresql") await db.query("ANALYZE demo_observation");
    const listed = demosForOwnerQuery(owner, brand);
    const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
    const plan = JSON.stringify(await queryWithParameters(db, explain + listed.sql, listed.values));
    assert.match(plan, /demo_observation_owner_idx|demo_observation/);
    if (db.kind === "postgresql") assert.doesNotMatch(plan, /Seq Scan on demo_observation/);

    const ddl = await testDatabase(kind, { ddl: true });
    t.after(() => ddl.cleanup());
    const ddlOwner = await account(ddl.connection);
    const ddlBrand = randomUUID();
    const ddlBrands = new BrandDao(ddl.connection);
    await ddlBrands.insertBrand(ddlOwner, ddlBrand, time);
    await assert.rejects(
      () => queryWithParameters(ddl.connection, `INSERT INTO demo_observation (
        id, brand_id, owner_id, question_text, answer_text, is_demo, operation_id, created_at
      ) VALUES (?, ?, ?, 'q', 'a', 0, ?, ?)`,
      [randomUUID(), ddlBrand, ddlOwner, randomUUID(), time]),
      /CHECK|check constraint/i,
    );
  });
}
