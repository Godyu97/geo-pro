import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openConnection, queryWithParameters } from "../../src/lib/db/connection.ts";
import { parseDatabaseConfig } from "../../src/lib/db/config.ts";
import { executeBrandCommand } from "../../src/features/brands/commands.ts";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { executePromptCommand, readPromptWorkspace } from "../../src/features/prompts/service.ts";
import { isNearDuplicate, normalizeQuestion } from "../../src/features/prompts/rules.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-19T02:00:00.000Z";
const clock = () => new Date(time);
const clusterId = "6d2d6c2e-3a4b-4c5d-8e6f-708192a3b4c5";

test("whitespace variants collapse and near duplicates stay distinct", () => {
  assert.equal(normalizeQuestion("  日常场景下如何判断是否合适 \n"), normalizeQuestion("日常场景下如何判断是否合适"));
  assert.equal(isNearDuplicate("日常场景下如何判断是否合适", "日常场景下如何判断是否合适"), false);
  assert.equal(isNearDuplicate("日常场景下如何判断是否合适", "日常场景下如何判断是否合适呢"), true);
});

function cluster() {
  return { id: clusterId, audience: "合成受众", intent: "了解购买限制", primaryPage: "", conversionAction: "" };
}

function question(id, text, extra = {}) {
  return {
    id, clusterId, text, source: "manual", sourceNote: "", type: "discovery", stage: "consider",
    region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary: false, ...extra,
  };
}

const primaryTexts = [
  "这个品类里大家通常会比较哪些条件",
  "日常使用时最先要确认的使用场景是什么",
  "预算有限时怎样判断一个选择是否合适",
];

async function addBrand(db) {
  const ownerId = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [ownerId, "Prompt owner fixture", `${ownerId}@example.invalid`]);
  const result = await executeBrandCommand(db, ownerId, {
    action: "submit", target: null, expectedDraft: null, actorId: ownerId, operationId: randomUUID(),
    fields: {
      ...initialBrandFields, name: "合成品牌", description: "合成数据用于本地验收",
      aliases: ["合成别名"], competitors: ["合成竞品"], questions: ["建档时留下的购买草稿问题"],
    },
  }, undefined, clock);
  assert.ok(result.mutation);
  return { ownerId, brandId: result.mutation.id };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: question clusters keep counts, duplicates, versions and references`, async () => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    const ddl = await testDatabase(kind, { ddl: true });
    let reopened;
    try {
      const db = fixture.connection;
      await migrateThrough(db, kind === "sqlite" ? "0008_sloppy_madrox" : "0009_short_maestro");
      const scope = await addBrand(db);
      const other = await addBrand(db);
      for (let repeat = 0; repeat < 2; repeat += 1) {
        execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: "pipe" });
      }
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const run = (command, target = scope) => executePromptCommand(db, target, command, clock);
      const read = (query = {}, target = scope) => readPromptWorkspace(db, target, query, );
      const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      const base = { action: "saveDraft", revision: null, baseSetId: null };
      const opened = await read();
      assert.equal(opened.editor.questions[0].text, "建档时留下的购买草稿问题");
      assert.equal(opened.candidates.length, 6);
      assert.equal(opened.candidates.every((item) => item.source === "generated" && !item.text.includes("合成")), true);

      const duplicate = {
        ...base,
        content: { clusters: [cluster()], questions: [question(ids[0], "日常场景下如何判断是否合适"), question(ids[1], "  日常场景下如何判断是否合适 \n")] },
      };
      assert.equal((await run(duplicate)).error, "duplicate");
      const similar = {
        ...base,
        content: { clusters: [cluster()], questions: [question(ids[0], "日常场景下如何判断是否合适"), question(ids[1], "日常场景下如何判断是否合适呢")] },
      };
      assert.deepEqual((await run(similar)).questionIds, [ids[0], ids[1]]);
      const kept = await run({ ...similar, content: { ...similar.content, questions: similar.content.questions.map((item, index) => index === 1 ? { ...item, acceptSimilar: true } : item) } });
      assert.equal(kept.revision, 1);
      assert.equal(kept.warnings.some((warning) => warning.code === "similar"), true);

      const leading = await run({
        action: "saveDraft", revision: 1, baseSetId: null,
        content: { clusters: [cluster()], questions: [question(ids[0], "请推荐这个品类里最好的日常选择"), question(ids[1], "购买前要确认合成别名的哪些限制")] },
      });
      assert.equal(leading.content.questions[0].type, "exploration");
      assert.equal(leading.content.questions[0].primary, false);
      assert.equal(leading.content.questions[1].primary, false);
      assert.equal(leading.warnings.some((warning) => warning.code === "leading"), true);
      assert.equal(leading.warnings.some((warning) => warning.code === "brandTerm"), true);

      const two = {
        action: "saveDraft", revision: 2, baseSetId: null,
        content: { clusters: [cluster()], questions: primaryTexts.slice(0, 2).map((text, index) => question(ids[index], text)) },
      };
      assert.equal((await run(two)).revision, 3);
      const setId = randomUUID();
      const early = { action: "freeze", id: randomUUID(), setId, revision: 3, baseSetId: null, content: two.content };
      assert.deepEqual(await run(early), { error: "notReady", adjustments: ["addPrimary"] });

      const four = primaryTexts.map((text, index) => question(ids[index], text)).concat(
        question(ids[3], "合成品牌和另一方案相比有哪些限制", { type: "comparison" }),
      );
      const ready = { clusters: [cluster()], questions: four };
      assert.equal((await run({ action: "saveDraft", revision: 3, baseSetId: null, content: ready })).preview.primary, 3);
      const frozenId = randomUUID();
      const frozen = await run({ action: "freeze", id: frozenId, setId, revision: 4, baseSetId: null, content: ready });
      assert.equal(frozen.preview.primary, 3);
      assert.equal(frozen.preview.saved, 4);
      assert.equal(frozen.budget.questionCount, 4);
      assert.equal(frozen.budget.primaryCount, 3);
      assert.equal(frozen.budget.repeatsFrozen, false);
      assert.equal(frozen.budget.channelFrozen, false);
      assert.deepEqual(await run({ action: "freeze", id: frozenId, setId, revision: 4, baseSetId: null, content: ready }), { ...frozen, revision: frozen.revision });

      const consumerId = randomUUID();
      assert.deepEqual((await run({ action: "reference", setVersionId: frozenId, consumerId })).questionIds, ids);
      const changedText = "这个品类里大家通常会比较哪些售后条件";
      const edited = four.map((item, index) => index === 0 ? { ...item, text: changedText } : item);
      const secondId = randomUUID();
      const second = await run({ action: "freeze", id: secondId, setId, revision: frozen.revision, baseSetId: frozenId, content: { clusters: [cluster()], questions: edited } });
      assert.equal(second.version, 2);
      assert.deepEqual(second.exclusion, [ids[0]]);
      const original = await read({ version: frozenId });
      assert.equal(original.selected.content.questions[0].text, primaryTexts[0]);
      assert.equal(original.selected.budget.primaryCount, 3);
      const latest = await read({ version: secondId });
      assert.equal(latest.selected.content.questions[0].text, changedText);
      assert.deepEqual(latest.selected.exclusion, [ids[0]]);
      const removed = { clusters: [cluster()], questions: edited.slice(1) };
      assert.equal((await run({ action: "saveDraft", revision: second.revision, baseSetId: secondId, content: removed })).error, "deactivateRequired");
      const inactive = edited.map((item, index) => index === 0 ? { ...item, status: "inactive", primary: false } : item);
      assert.equal((await run({ action: "saveDraft", revision: second.revision, baseSetId: secondId, content: { clusters: [cluster()], questions: inactive } })).revision, second.revision + 1);
      assert.equal(await read({}, { ...scope, ownerId: other.ownerId }), null);
      assert.equal((await run({ action: "reference", setVersionId: frozenId, consumerId }, other)).error, "notFound");
      assert.equal((await run({ action: "saveDraft", revision: null, baseSetId: null, content: ready }, { ...scope, brandId: other.brandId })).error, "notFound");

      const cfg = parseDatabaseConfig(fixture.env);
      assert.ok(cfg.success);
      reopened = openConnection(cfg.data);
      const restored = await readPromptWorkspace(reopened, scope, { version: frozenId }, clock);
      assert.equal(restored.selected.content.questions[0].text, primaryTexts[0]);
      assert.equal(restored.editor.questions[0].text, changedText);
      assert.equal(restored.editor.questions[0].language, "zh-CN");

      const captured = [];
      const observed = { kind: db.kind, query(sql, values) { captured.push({ sql, values }); return db.query(sql, values); } };
      captured.length = 0;
      const before = performance.now();
      await readPromptWorkspace(observed, scope, { version: frozenId }, clock);
      const baseline = captured.length;
      const rows = Array.from({ length: 500 }, () => randomUUID());
      await queryWithParameters(db, `INSERT INTO prompt_set
        (brand_id, id, set_id, version, entity_version, region, language, content, created_at)
        VALUES ${rows.map(() => "(?, ?, ?, ?, 1, 'CN', 'zh-CN', ?, ?)").join(",")}`,
      rows.flatMap((id, index) => [scope.brandId, id, setId, index + 10, JSON.stringify({ clusters: [], questions: [] }), time]));
      if (db.kind === "postgresql") await db.query("ANALYZE prompt_set");
      captured.length = 0;
      const started = performance.now();
      const listed = await readPromptWorkspace(observed, scope, { version: frozenId }, clock);
      assert.equal(captured.length, baseline);
      assert.equal(listed.versions.items.length, 20);
      const listQuery = captured.find(({ sql }) => sql.includes("FROM prompt_set") && sql.includes("ORDER BY created_at DESC"));
      const plan = await db.query((db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ") + listQuery.sql, listQuery.values);
      assert.match(JSON.stringify(plan), /prompt_set_recent_idx/);
      console.log(`${kind} prompt workspace ${baseline} SQL, before bulk ${(performance.now() - before).toFixed(2)} ms, 500 versions ${(performance.now() - started).toFixed(2)} ms`);
      const older = await readPromptWorkspace(db, scope, { version: frozenId, after: listed.versions.next }, clock);
      assert.ok(older.versions.items.every((item) => !listed.versions.items.some((first) => first.id === item.id)));

      await db.transaction((tx) => new PurgeDao(tx).clearContents(scope, time));
      for (const table of ["prompt_draft", "prompt_set", "prompt_reference", "prompt_ai_suggestion"]) {
        assert.deepEqual(await queryWithParameters(db, `SELECT brand_id FROM ${table} WHERE brand_id = ?`, [scope.brandId]), []);
      }
    } finally {
      await reopened?.close();
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
