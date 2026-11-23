import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { executeBrandCommand } from "../../src/features/brands/commands.ts";
import { ensureRetentionPolicy } from "../brands/retention-setup.mjs";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { executePromptCommand, readPromptWorkspace } from "../../src/features/prompts/service.ts";
import { executePromptSuggestion, readPromptSuggestions } from "../../src/features/prompts/suggestions.ts";
import { isNearDuplicate, normalizeQuestion } from "../../src/features/prompts/rules.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T02:00:00.000Z";
const clock = () => new Date(time);
const clusterId = "6d2d6c2e-3a4b-4c5d-8e6f-708192a3b4c5";
const existing = "日常场景下如何判断是否合适";
const near = "日常场景下如何判断是否合适呢";
const fresh = "长期使用前需要确认哪些维护和售后条件";
const env = {
  OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "loopback-model",
};

function cluster() {
  return { id: clusterId, audience: "合成受众", intent: "了解购买限制", primaryPage: "", conversionAction: "" };
}

function question(id, text, extra = {}) {
  return {
    id, clusterId, text, source: "manual", sourceNote: "", type: "discovery", stage: "consider",
    region: "CN", language: "zh-CN", status: "confirmed", acceptSimilar: false, primary: false, ...extra,
  };
}

async function addBrand(db) {
  const ownerId = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [ownerId, "Suggestion owner fixture", `${ownerId}@example.invalid`]);
  const result = await executeBrandCommand(db, ownerId, {
    action: "submit", target: null, expectedDraft: null, actorId: ownerId, operationId: randomUUID(),
    acceptedPolicyVersion: await ensureRetentionPolicy(db, clock),
    fields: {
      ...initialBrandFields, name: "合成品牌", description: "合成数据用于本地验收",
      aliases: ["合成别名"], competitors: ["合成竞品"], questions: ["建档时留下的购买草稿问题"],
    },
  }, undefined, clock);
  assert.ok(result.mutation);
  return { ownerId, brandId: result.mutation.id };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: response suggestions drop exact duplicates and stay out of the set until accepted`, async () => {
    assert.equal(isNearDuplicate(existing, near), true);
    assert.equal(isNearDuplicate(existing, fresh), false);
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const scope = await addBrand(db);
      const other = await addBrand(db);
      const saved = await executePromptCommand(db, scope, {
        action: "saveDraft", revision: null, baseSetId: null,
        content: { clusters: [cluster()], questions: [question(randomUUID(), existing)] },
      }, clock);
      assert.equal(saved.revision, 1);
      assert.equal(saved.content.questions.length, 1);

      let allowFetch = false;
      let mode = "invalid";
      const calls = [];
      const fetchImpl = async (url, init) => {
        assert.equal(allowFetch, true);
        const body = JSON.parse(init.body);
        calls.push({ url: String(url), body, authorization: init.headers.Authorization });
        const text = mode === "invalid"
          ? "内部口令不要写入题集"
          : JSON.stringify({
            questions: [
              { text: `  ${existing} \n`, type: "discovery", stage: "consider" },
              { text: near, type: "scenario", stage: "consider" },
              { text: fresh, type: "constraint", stage: "compare" },
            ],
          });
        return new Response(JSON.stringify({
          id: "resp_loopback", status: "completed", model: "loopback-model",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      };
      const run = (input, runEnv = env) => executePromptSuggestion(db, scope, input, { clock, env: runEnv, fetchImpl });
      const rows = () => queryWithParameters(db, `SELECT status, model_name AS "modelName", candidate
        FROM prompt_ai_suggestion WHERE brand_id = ?`, [scope.brandId]);

      const unconfigured = await run({ action: "generate", promptSetId: null }, {});
      assert.deepEqual(unconfigured, { error: "aiUnavailable" });
      assert.equal(calls.length, 0);
      allowFetch = true;
      const invalidCall = await run({ action: "generate", promptSetId: null });
      assert.deepEqual(invalidCall, { error: "invalidModelOutput" });
      assert.equal(JSON.stringify(invalidCall).includes("内部口令"), false);
      assert.equal((await rows()).length, 0);
      assert.equal((await readPromptWorkspace(db, scope, {})).editor.questions.length, 1);

      mode = "ok";
      const generated = await run({ action: "generate", promptSetId: null });
      assert.equal(generated.discarded, 1);
      assert.equal(generated.suggestions.length, 2);
      const nearRow = generated.suggestions.find((item) => item.candidate.text === near);
      const freshRow = generated.suggestions.find((item) => item.candidate.text === fresh);
      assert.ok(nearRow);
      assert.ok(freshRow);
      assert.deepEqual(nearRow.candidate.warnings, ["similar"]);
      assert.deepEqual(freshRow.candidate.warnings, []);
      assert.equal(generated.suggestions.some((item) => normalizeQuestion(item.candidate.text) === normalizeQuestion(existing)), false);
      const request = calls.at(-1);
      assert.equal(request.url.endsWith("/responses"), true);
      assert.equal(request.body.store, false);
      assert.equal(request.authorization, "Bearer test-key");
      assert.equal(JSON.stringify(request.body).includes("test-key"), false);
      assert.equal(request.body.instructions.includes(existing), false);
      assert.deepEqual(JSON.parse(request.body.input), {
        business: "合成数据用于本地验收", region: "CN", language: "zh-CN", questions: [existing],
      });
      const stored = await rows();
      assert.equal(stored.length, 2);
      assert.equal(stored.every((row) => row.status === "draft" && row.modelName === "loopback-model"), true);
      assert.equal(JSON.stringify(stored).includes("内部口令"), false);
      const afterGenerate = await readPromptWorkspace(db, scope, {});
      assert.equal(afterGenerate.editor.questions.length, 1);
      assert.equal(afterGenerate.suggestions.length, 2);
      assert.deepEqual(await queryWithParameters(db, "SELECT id FROM prompt_set WHERE brand_id = ?", [scope.brandId]), []);
      assert.deepEqual(await queryWithParameters(db, "SELECT id FROM monitoring_run WHERE brand_id = ?", [scope.brandId]), []);

      const accepted = await run({ action: "accept", id: freshRow.id });
      assert.equal(accepted.status, "accepted");
      assert.equal(accepted.revision, 2);
      assert.equal(accepted.content.questions.filter((item) => item.text === fresh).length, 1);
      assert.equal(accepted.question.source, "generated");
      assert.equal(accepted.question.sourceNote, "responses-api");
      assert.equal(accepted.question.type, "constraint");
      const dismissed = await run({ action: "dismiss", id: nearRow.id });
      assert.deepEqual(dismissed, { id: nearRow.id, status: "dismissed" });
      const viewed = await readPromptWorkspace(db, scope, {});
      assert.equal(viewed.editor.questions.filter((item) => item.text === fresh).length, 1);
      assert.equal(viewed.editor.questions.some((item) => item.text === near), false);
      assert.equal(viewed.suggestions.length, 0);
      assert.equal((await rows()).find((row) => row.candidate.includes(fresh)).status, "accepted");
      assert.equal((await rows()).find((row) => row.candidate.includes(near)).status, "dismissed");
      assert.deepEqual(await queryWithParameters(db, "SELECT id FROM prompt_set WHERE brand_id = ?", [scope.brandId]), []);

      const hidden = await readPromptSuggestions(db, { ownerId: other.ownerId, brandId: scope.brandId });
      const denied = await executePromptSuggestion(db, { ownerId: other.ownerId, brandId: scope.brandId }, { action: "accept", id: freshRow.id }, { clock, env, fetchImpl });
      assert.equal(hidden, null);
      assert.equal(denied.error, "notFound");
      assert.equal(`${JSON.stringify(hidden)}${JSON.stringify(denied)}`.includes(fresh), false);
      assert.equal(`${JSON.stringify(hidden)}${JSON.stringify(denied)}`.includes(near), false);

      const filler = JSON.stringify({ text: "合成候选仅用于查询计划", type: "discovery", stage: "awareness", warnings: [] });
      await queryWithParameters(db, `INSERT INTO prompt_ai_suggestion
        (id, brand_id, owner_id, prompt_set_id, status, model_name, candidate, created_at)
        VALUES ${Array.from({ length: 40 }, () => "(?, ?, ?, null, 'draft', 'loopback-model', ?, ?)").join(", ")}`,
      Array.from({ length: 40 }, () => [randomUUID(), scope.brandId, scope.ownerId, filler, time]).flat());
      const captured = [];
      const observed = { kind: db.kind, query(sql, values) { captured.push({ sql, values }); return db.query(sql, values); } };
      await readPromptWorkspace(observed, scope, {});
      const listQuery = captured.find((item) => item.sql.includes("FROM prompt_ai_suggestion"));
      assert.ok(listQuery);
      const plan = await db.query(`${db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN "}${listQuery.sql}`, listQuery.values);
      assert.match(JSON.stringify(plan), /prompt_ai_suggestion_owner_idx/);
      console.log(`${kind} suggestion list uses prompt_ai_suggestion_owner_idx`);

      await db.transaction((tx) => new PurgeDao(tx).clearContents(scope, time));
      assert.deepEqual(await queryWithParameters(db, "SELECT brand_id FROM prompt_ai_suggestion WHERE brand_id = ?", [scope.brandId]), []);
      assert.deepEqual(await queryWithParameters(db, "SELECT brand_id FROM prompt_draft WHERE brand_id = ?", [scope.brandId]), []);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
