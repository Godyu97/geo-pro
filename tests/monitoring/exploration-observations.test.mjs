import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import {
  listExplorationObservations,
  recordExplorationObservation,
} from "../../src/features/monitoring/exploration-commands.ts";
import {
  createExplorationSchema,
  explorationErrors,
} from "../../src/features/monitoring/exploration-contracts.ts";
import { ExplorationDao, explorationsForOwnerQuery } from "../../src/features/monitoring/exploration-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { memoryCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const clock = () => time;
const question = "隔离诊断题：北岸泵该不该进自然分母？";
const answer = "这是探索回答，不能进入自然样本。";
const fields = {
  name: "乙品牌", description: "Synthetic brand for exploration isolation", website: "https://yi.example.com",
  aliases: ["乙"], region: "CN", language: "zh-CN", competitors: [], questions: [],
};
const naturalFiles = [
  "src/features/evidence/dao.ts",
  "src/features/evidence/overview-commands.ts",
  "src/features/evidence/metrics.ts",
  "src/features/reports/dao.ts",
  "src/features/reports/snapshot.ts",
  "src/features/reports/rules.ts",
  "src/features/functional-mock/apply-retest.ts",
];

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
    [id, "Exploration owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
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

function explorationInput(brandId, operationId, answerText = answer) {
  return {
    operationId,
    brandId,
    questionText: question,
    answerText,
    exclusionReason: "custom_pipeline",
  };
}

test("exploration input stays out of natural answers and safe return paths", async () => {
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const operationId = "4160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const valid = explorationInput(brandId, operationId);
  assert.equal(createExplorationSchema.safeParse(valid).success, true);
  assert.equal(createExplorationSchema.safeParse({ ...valid, copyToAnswerObservation: true }).success, false);
  assert.equal(createExplorationSchema.safeParse({ ...valid, excludedFromNatural: 0 }).success, false);
  assert.equal(createExplorationSchema.safeParse({ ...valid, exclusionReason: "model_api" }).success, false);
  assert.equal(createExplorationSchema.safeParse({ ...valid, sourceMode: "custom_pipeline" }).success, false);
  assert.equal(explorationErrors.NOT_FOUND, 404);
  assert.equal(explorationErrors.NATURAL_COPY_REJECTED, 409);
  assert.equal(safeReturnTo("/dashboard/monitoring/explorations"), "/dashboard/monitoring/explorations");
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url), "utf8"));
  assert.match(zhCN.explorations.description, /不进入/);
  assert.match(zhCN.explorations.description, /custom_pipeline/);
  assert.match(zhCN.explorations.fixtureNote, /不是正式观察/);
  assert.match(en.explorations.description, /numerator or denominator/i);
  assert.match(en.explorations.fixtureNote, /not a formal observation/i);
  assert.equal(JSON.stringify(zhCN.explorations).includes(question), false);
  assert.equal(JSON.stringify(en.explorations).includes(answer), false);
  const api = await readFile(new URL("../../src/features/monitoring/exploration-api.ts", import.meta.url), "utf8");
  assert.match(api, /status: explorationErrors\[code\]/);
  const denied = Response.json({ error: { code: "NOT_FOUND", message: zhCN.explorations.NOT_FOUND } }, { status: explorationErrors.NOT_FOUND });
  assert.equal(denied.status, 404);
  const body = await denied.json();
  assert.equal(JSON.stringify(body).includes(question), false);
  assert.equal(JSON.stringify(body).includes(answer), false);
  const command = await readFile(new URL("../../src/features/monitoring/exploration-commands.ts", import.meta.url), "utf8");
  const dao = await readFile(new URL("../../src/features/monitoring/exploration-dao.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../../src/features/monitoring/explorations-page.tsx", import.meta.url), "utf8");
  assert.equal(command.includes("copyToAnswerObservation"), true);
  assert.equal(/insert\s+into\s+answer_observation/i.test(command), false);
  assert.equal(/from\s+answer_observation/i.test(command), false);
  assert.equal(command.includes("monitoring_slot"), false);
  assert.equal(command.includes("quota_"), false);
  assert.equal(command.includes("createAiResponse"), false);
  assert.match(dao, /INSERT INTO exploration_observation/);
  assert.equal(/answer_observation/i.test(dao), false);
  assert.equal(page.includes("description") && page.includes("fixtureNote"), true);
  for (const file of naturalFiles) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("exploration_observation"), false, file);
  }
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: exploration rows stay out of the natural denominator`, async (t) => {
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
      locatorRef: "fixture://exploration/natural",
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
    const scope = { brandId: brand, sourceMode: "consumer_ui" };
    const before = await readEvidenceOverview(db, owner, scope, memoryCache());
    assert.equal("error" in before, false);
    assert.ok(before.sampleCount >= 1);
    assert.ok(before.metrics.recommended.pooled.denominator > 0);
    const answersBefore = await countBy(db, "answer_observation", "brand_id", brand);
    const slotsBefore = await countBy(db, "monitoring_slot", "brand_id", brand);
    const quotaBefore = await countBy(db, "quota_reservation", "brand_id", brand);

    const operationId = randomUUID();
    const saved = await recordExplorationObservation(db, owner, explorationInput(brand, operationId), clock);
    assert.equal(saved.error, undefined);
    assert.equal(saved.observation.excludedFromNatural, true);
    assert.equal(saved.observation.exclusionReason, "custom_pipeline");
    assert.equal(await countBy(db, "answer_observation", "brand_id", brand), answersBefore);
    assert.equal(await countBy(db, "monitoring_slot", "brand_id", brand), slotsBefore);
    assert.equal(await countBy(db, "quota_reservation", "brand_id", brand), quotaBefore);
    assert.equal(await countBy(db, "exploration_observation", "brand_id", brand), 1);
    const after = await readEvidenceOverview(db, owner, scope, memoryCache());
    assert.deepEqual(rates(after), rates(before));
    assert.equal(after.answers.some((item) => item.questionText === question), false);

    const replay = await recordExplorationObservation(db, owner, explorationInput(brand, operationId), clock);
    assert.equal(replay.observation.id, saved.observation.id);
    assert.equal(await countBy(db, "exploration_observation", "brand_id", brand), 1);
    const conflict = await recordExplorationObservation(db, owner, explorationInput(brand, operationId, "另一条探索回答"), clock);
    assert.equal(conflict.error, "OPERATION_CONFLICT");
    assert.equal(await countBy(db, "answer_observation", "brand_id", brand), answersBefore);

    const watched = watch(db);
    const second = await recordExplorationObservation(watched.connection, owner, explorationInput(brand, randomUUID(), "第二条探索回答"), clock);
    assert.equal(second.error, undefined);
    assert.equal(writes(watched.captured, "exploration_observation").length, 1);
    assert.equal(writes(watched.captured, "answer_observation").length, 0);
    assert.equal(writes(watched.captured, "monitoring_slot").length, 0);
    assert.equal(writes(watched.captured, "quota_reservation").length, 0);
    assert.equal(watched.captured.some((item) => item.sql.includes("exploration_observation") && /select/i.test(item.sql) && item.sql.includes("answer_observation")), false);

    const beforeCopy = await countBy(db, "exploration_observation", "brand_id", brand);
    const refused = await recordExplorationObservation(db, owner, { ...explorationInput(brand, randomUUID()), copyToAnswerObservation: true }, clock);
    assert.equal(refused.error, "NATURAL_COPY_REJECTED");
    assert.equal(await countBy(db, "exploration_observation", "brand_id", brand), beforeCopy);
    assert.equal(await countBy(db, "answer_observation", "brand_id", brand), answersBefore);

    const hidden = await listExplorationObservations(db, outsider, brand);
    assert.equal(hidden.error, "NOT_FOUND");
    assert.equal(JSON.stringify(hidden).includes(question), false);
    assert.equal(JSON.stringify(hidden).includes(answer), false);
    const visible = await listExplorationObservations(db, owner, brand);
    assert.equal(visible.observations.some((item) => item.questionText === question && item.answerText === answer), true);
    const overviewWatch = watch(db);
    const still = await readEvidenceOverview(overviewWatch.connection, owner, scope, memoryCache());
    assert.deepEqual(rates(still), rates(before));
    assert.equal(overviewWatch.captured.some((item) => item.sql.includes("exploration_observation")), false);
    assert.equal(overviewWatch.captured.some((item) => item.sql.includes("answer_observation")), true);

    await assert.rejects(
      () => queryWithParameters(db, `UPDATE exploration_observation SET excluded_from_natural = 0 WHERE id = ?`, [saved.observation.id]),
      /CHECK|check constraint/i,
    );
    await assert.rejects(
      () => queryWithParameters(db, `UPDATE exploration_observation SET exclusion_reason = 'model_api' WHERE id = ?`, [saved.observation.id]),
      /CHECK|check constraint/i,
    );
    const fingerprint = createHash("sha256").update("custom-pipeline").digest("hex");
    await assert.rejects(
      () => queryWithParameters(db, `INSERT INTO answer_observation (
        id, brand_id, owner_id, source_mode, capture_method, question_text, answer_text,
        fingerprint, captured_at, region, language, requested_network_mode, entity_version,
        citation_set_state, evidence_state, created_at, target_region, observed_region,
        new_session, product_mode
      ) VALUES (?, ?, ?, 'custom_pipeline', 'isolated', ?, ?, ?, ?, 'CN', 'zh-CN', 'unknown', 1,
        'missing', 'complete', ?, 'CN', 'unknown', 'unknown', 'unknown')`,
      [randomUUID(), brand, owner, question, answer, fingerprint, time, time]),
      /CHECK|check constraint/i,
    );
    assert.equal(await countBy(db, "answer_observation", "brand_id", brand), answersBefore);

    await assert.rejects(
      () => db.transaction(async (tx) => {
        await new ExplorationDao(tx).insert({
          id: randomUUID(),
          brandId: brand,
          ownerId: owner,
          questionText: question,
          answerText: answer,
          exclusionReason: "custom_pipeline",
          excludedFromNatural: 1,
          operationId: randomUUID(),
          createdAt: time,
        });
        throw new Error("rollback-fixture");
      }),
      /rollback-fixture/,
    );
    assert.equal(await countBy(db, "exploration_observation", "brand_id", brand), beforeCopy);

    const shape = await structure(db);
    const defined = JSON.stringify(shape);
    assert.match(defined, /exploration_observation/);
    assert.match(defined, /excluded_from_natural/);
    assert.match(defined, /custom_pipeline/);

    const otherBrand = randomUUID();
    await brands.insertBrand(outsider, otherBrand, time);
    const extraIds = Array.from({ length: 200 }, () => randomUUID());
    for (let offset = 0; offset < extraIds.length; offset += 100) {
      const chunk = extraIds.slice(offset, offset + 100);
      await queryWithParameters(
        db,
        `INSERT INTO exploration_observation (
          id, brand_id, owner_id, question_text, answer_text, exclusion_reason,
          excluded_from_natural, operation_id, created_at
        ) VALUES ${chunk.map(() => "(?, ?, ?, 'q', 'a', 'custom_pipeline', 1, ?, ?)").join(", ")}`,
        chunk.flatMap((id) => [id, otherBrand, outsider, id, time]),
      );
    }
    if (db.kind === "postgresql") await db.query("ANALYZE exploration_observation");
    const listed = explorationsForOwnerQuery(owner, brand);
    const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
    const plan = JSON.stringify(await queryWithParameters(db, explain + listed.sql, listed.values));
    assert.match(plan, /exploration_observation_owner_idx|exploration_observation/);
    if (db.kind === "postgresql") assert.doesNotMatch(plan, /Seq Scan on exploration_observation/);

    const ddl = await testDatabase(kind, { ddl: true });
    t.after(() => ddl.cleanup());
    const ddlOwner = await account(ddl.connection);
    const ddlBrand = randomUUID();
    const ddlBrands = new BrandDao(ddl.connection);
    await ddlBrands.insertBrand(ddlOwner, ddlBrand, time);
    await assert.rejects(
      () => queryWithParameters(ddl.connection, `INSERT INTO exploration_observation (
        id, brand_id, owner_id, question_text, answer_text, exclusion_reason,
        excluded_from_natural, operation_id, created_at
      ) VALUES (?, ?, ?, 'q', 'a', 'custom_pipeline', 0, ?, ?)`,
      [randomUUID(), ddlBrand, ddlOwner, randomUUID(), time]),
      /CHECK|check constraint/i,
    );
  });
}
