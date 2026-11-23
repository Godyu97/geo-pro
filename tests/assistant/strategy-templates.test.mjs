import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import {
  draftStrategyTemplateSchema,
  saveStrategyTemplateSchema,
} from "../../src/features/assistant/strategy-contracts.ts";
import { strategyTemplatesForBrandQuery } from "../../src/features/assistant/strategy-dao.ts";
import {
  draftStrategyTemplate,
  listStrategyTemplates,
  readStrategyTemplate,
  saveStrategyTemplate,
} from "../../src/features/assistant/strategy-commands.ts";
import { evidenceStrengthAllowed, stripGuaranteeSentences } from "../../src/features/assistant/strategy-template.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-24T03:00:00.000Z";
const industry = "合成餐饮观察";
const sampling = "目标城市上海，实际采样未声明定位";
const failure = "上次只记录了一次成功，样本不足以重复观察。";
const kept = "先按采样条件记录一次观察。";
const mixed = `${kept}高胜率必有效。Guaranteed improvement is not stored.`;
const env = {
  OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  OPENAI_API_KEY: "sk-test-loopback",
  OPENAI_MODEL: "loopback-model",
};

test("one success stays a single observation and guarantee sentences are dropped", () => {
  assert.equal(evidenceStrengthAllowed(1, "single_observation"), true);
  assert.equal(evidenceStrengthAllowed(1, "repeated_observation"), false);
  assert.equal(evidenceStrengthAllowed(1, "insufficient"), false);
  assert.equal(evidenceStrengthAllowed(0, "insufficient"), true);
  assert.equal(evidenceStrengthAllowed(2, "repeated_observation"), true);
  assert.equal(stripGuaranteeSentences(mixed), kept);
  assert.equal(stripGuaranteeSentences("高胜率必有效。"), "");
  assert.equal(safeReturnTo("/dashboard/assistant/strategies"), "/dashboard/assistant/strategies");
  assert.equal(safeReturnTo("/dashboard/assistant/strategies?brandId=1"), "/dashboard/assistant/strategies?brandId=1");
  const base = {
    brandId: "3160d7dc-1cae-4d26-8ce4-fd2b886c8192",
    industry,
    samplingCondition: sampling,
    successes: 1,
    evidenceStrength: "single_observation",
    failureCase: failure,
    explanation: kept,
  };
  assert.equal(saveStrategyTemplateSchema.safeParse(base).success, true);
  assert.equal(saveStrategyTemplateSchema.safeParse({ ...base, failureCase: " " }).success, false);
  assert.equal(saveStrategyTemplateSchema.safeParse({ ...base, evidenceStrength: "repeated_observation" }).success, false);
  assert.equal(saveStrategyTemplateSchema.safeParse({ ...base, guaranteed: true }).success, false);
  assert.equal(draftStrategyTemplateSchema.safeParse({
    brandId: base.brandId,
    industry: base.industry,
    samplingCondition: base.samplingCondition,
    successes: base.successes,
    evidenceStrength: base.evidenceStrength,
    failureCase: base.failureCase,
    materials: "只作为数据",
  }).success, true);
});

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

function writes(captured) {
  return captured.filter((item) => /^\s*(insert|update|delete)/i.test(item.sql));
}

function clockFrom(start) {
  let step = 0;
  return () => new Date(Date.parse(start) + step++ * 1000).toISOString();
}

async function count(db, table, column, value) {
  const [row] = await queryWithParameters(db, `SELECT COUNT(*) AS "count" FROM ${table} WHERE ${column} = ?`, [value]);
  return Number(row.count);
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Strategy owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function responseFor(text) {
  return new Response(JSON.stringify({
    id: "resp_loopback",
    status: "completed",
    model: "loopback-model",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function tableSql(shape, table) {
  if (Array.isArray(shape)) {
    return shape.filter((row) => row.tbl_name === table).map((row) => row.sql ?? "").join("\n").toLowerCase();
  }
  return shape.columns.filter((row) => row.table_name === table).map((row) => row.column_name).join(",").toLowerCase();
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: a single success is stored as an observation and guarantee sentences stay out`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      const migrated = await structure(db);
      assert.deepEqual(migrated, await structure(ddl.connection));
      const defined = JSON.stringify(migrated);
      assert.match(defined, /strategy_template_owner_idx/);
      assert.match(defined, /strategy_template_state_check/);
      const columns = tableSql(migrated, "strategy_template");
      for (const word of ["password", "token", "secret", "cookie", "高胜率", "guaranteed improvement"]) {
        assert.equal(columns.includes(word), false, word);
      }
      assert.equal(columns.includes("failure_case"), true);
      assert.equal(columns.includes("evidence_strength"), true);

      const [owner, outsider] = await Promise.all([account(db), account(db)]);
      const brand = randomUUID();
      const otherBrand = randomUUID();
      const brands = new BrandDao(db);
      await brands.insertBrand(owner, brand, time);
      await brands.insertBrand(outsider, otherBrand, time);
      await brands.insertVersion(brand, 1, {
        ...initialBrandFields,
        name: "合成策略品牌",
        description: "合成品牌资料，仅用于策略模板",
      }, time);
      await brands.insertVersion(otherBrand, 1, {
        ...initialBrandFields,
        name: "合成对照品牌",
        description: "合成品牌资料，仅用于隔离模板",
      }, time);
      const clock = clockFrom(time);
      const plans = () => count(db, "assistant_plan", "brand_id", brand);
      assert.equal(await plans(), 0);
      assert.equal(await count(db, "strategy_template", "brand_id", brand), 0);

      const missing = watch(db);
      const rejected = await saveStrategyTemplate(missing.connection, owner, {
        brandId: brand,
        industry,
        samplingCondition: sampling,
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: " ",
        explanation: kept,
      }, { clock });
      assert.deepEqual(rejected, { error: "INVALID_INPUT" });
      assert.equal(writes(missing.captured).length, 0);
      assert.equal(await count(db, "strategy_template", "brand_id", brand), 0);

      const repeated = watch(db);
      const repeatedResult = await saveStrategyTemplate(repeated.connection, owner, {
        brandId: brand,
        industry,
        samplingCondition: sampling,
        successes: 1,
        evidenceStrength: "repeated_observation",
        failureCase: failure,
        explanation: kept,
      }, { clock });
      assert.deepEqual(repeatedResult, { error: "INVALID_INPUT" });
      assert.equal(writes(repeated.captured).length, 0);
      assert.equal(await count(db, "strategy_template", "brand_id", brand), 0);

      const saved = await saveStrategyTemplate(db, owner, {
        brandId: brand,
        industry,
        samplingCondition: sampling,
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: failure,
        explanation: mixed,
      }, { clock });
      assert.equal(saved.template.evidenceStrength, "single_observation");
      assert.equal(saved.template.guaranteed, 0);
      assert.equal(saved.template.label, "observation");
      assert.equal(saved.template.explanation, kept);
      assert.equal(saved.template.failureCase, failure);
      assert.equal(saved.template.industry, industry);
      assert.equal(saved.template.samplingCondition, sampling);
      const [row] = await queryWithParameters(
        db,
        `SELECT evidence_strength AS "evidenceStrength", guaranteed, strategy_label AS "label", explanation
         FROM strategy_template WHERE id = ? AND owner_id = ?`,
        [saved.template.id, owner],
      );
      assert.equal(row.evidenceStrength, "single_observation");
      assert.equal(Number(row.guaranteed), 0);
      assert.equal(row.label, "observation");
      assert.equal(String(row.explanation).includes("高胜率"), false);
      assert.equal(String(row.explanation).includes("必有效"), false);
      assert.equal(String(row.explanation).toLowerCase().includes("guaranteed improvement"), false);

      const repeatedOk = await saveStrategyTemplate(db, owner, {
        brandId: brand,
        industry,
        samplingCondition: sampling,
        successes: 2,
        evidenceStrength: "repeated_observation",
        failureCase: failure,
        explanation: kept,
      }, { clock });
      assert.equal(repeatedOk.template.evidenceStrength, "repeated_observation");
      assert.equal(repeatedOk.template.guaranteed, 0);

      let mode = "mixed";
      const calls = [];
      const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        if (mode === "down") throw new Error("loopback-down");
        const explanation = mode === "guarantee" ? "高胜率必有效。Guaranteed improvement." : mixed;
        return responseFor(JSON.stringify({ explanation }));
      };
      const options = { clock, env, fetchImpl };
      const beforeDraft = await count(db, "strategy_template", "brand_id", brand);
      const drafted = await draftStrategyTemplate(db, owner, {
        brandId: brand,
        industry,
        samplingCondition: sampling,
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: failure,
        materials: "材料里写了高胜率。必有效。guaranteed improvement",
      }, options);
      assert.equal(drafted.template.explanation, kept);
      assert.equal(drafted.template.guaranteed, 0);
      assert.equal(drafted.template.label, "observation");
      assert.equal(calls.length, 1);
      assert.equal(String(calls[0].url).endsWith("/responses"), true);
      assert.match(calls[0].body.instructions, /Do not promise a return/);
      assert.equal(calls[0].body.instructions.includes("材料里写了高胜率"), false);
      const modelInput = JSON.parse(calls[0].body.input);
      assert.equal(modelInput.evidenceStrength, "single_observation");
      assert.equal(modelInput.successes, 1);
      const [draftRow] = await queryWithParameters(
        db,
        `SELECT explanation, guaranteed FROM strategy_template WHERE id = ?`,
        [drafted.template.id],
      );
      assert.equal(String(draftRow.explanation).includes("高胜率"), false);
      assert.equal(String(draftRow.explanation).includes("必有效"), false);
      assert.equal(String(draftRow.explanation).toLowerCase().includes("guaranteed improvement"), false);
      assert.equal(String(draftRow.explanation).includes("材料里写了"), false);
      assert.equal(Number(draftRow.guaranteed), 0);

      mode = "guarantee";
      const onlyGuarantee = await draftStrategyTemplate(db, owner, {
        brandId: brand,
        industry,
        samplingCondition: sampling,
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: failure,
        materials: "只描述失败案例",
      }, options);
      assert.deepEqual(onlyGuarantee, { error: "INVALID_MODEL_OUTPUT" });
      assert.equal(await count(db, "strategy_template", "brand_id", brand), beforeDraft + 1);

      mode = "down";
      const failed = await draftStrategyTemplate(db, owner, {
        brandId: brand,
        industry,
        samplingCondition: sampling,
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: failure,
        materials: "只描述失败案例",
      }, options);
      assert.equal(failed.error, "AI_FAILED");
      assert.equal(await count(db, "strategy_template", "brand_id", brand), beforeDraft + 1);

      const unavailable = await draftStrategyTemplate(db, owner, {
        brandId: brand,
        industry,
        samplingCondition: sampling,
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: failure,
        materials: "只描述失败案例",
      }, { clock, env: {}, fetchImpl });
      assert.deepEqual(unavailable, { error: "AI_UNAVAILABLE" });
      assert.equal(calls.length, 3);

      const hidden = await saveStrategyTemplate(db, outsider, {
        brandId: brand,
        industry: "不应看见的行业",
        samplingCondition: "不应看见的条件",
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: "不应看见的失败案例",
        explanation: kept,
      }, { clock });
      assert.deepEqual(hidden, { error: "NOT_FOUND" });
      const outsiderRead = await readStrategyTemplate(db, outsider, saved.template.id);
      assert.deepEqual(outsiderRead, { error: "NOT_FOUND" });
      const hiddenText = JSON.stringify(outsiderRead);
      assert.equal(hiddenText.includes(industry), false);
      assert.equal(hiddenText.includes(sampling), false);
      assert.equal(hiddenText.includes(failure), false);
      const outsiderList = await listStrategyTemplates(db, outsider, brand);
      assert.deepEqual(outsiderList, { error: "NOT_FOUND" });
      assert.equal(JSON.stringify(outsiderList).includes(industry), false);

      const visible = await readStrategyTemplate(db, owner, saved.template.id);
      assert.equal(visible.template.industry, industry);
      assert.equal(visible.template.samplingCondition, sampling);
      assert.equal(visible.template.failureCase, failure);
      assert.equal(visible.template.guaranteed, 0);
      const listed = await listStrategyTemplates(db, owner, brand);
      assert.equal(listed.templates.some((item) => item.id === saved.template.id), true);
      assert.equal(listed.templates.every((item) => item.guaranteed === 0 && item.label === "observation"), true);
      assert.equal(await plans(), 0);

      const rolled = randomUUID();
      await assert.rejects(
        () => db.transaction(async (tx) => {
          await queryWithParameters(
            tx,
            `INSERT INTO strategy_template (
              id, brand_id, owner_id, industry, sampling_condition, evidence_strength,
              failure_case, explanation, strategy_label, guaranteed, successes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'single_observation', ?, ?, 'observation', 0, 1, ?, ?)`,
            [rolled, brand, owner, industry, sampling, failure, kept, time, time],
          );
          throw new Error("rollback-fixture");
        }),
        /rollback-fixture/,
      );
      assert.equal(await count(db, "strategy_template", "id", rolled), 0);

      await assert.rejects(
        () => queryWithParameters(db, `UPDATE strategy_template SET guaranteed = 1 WHERE id = ?`, [saved.template.id]),
        /CHECK|check constraint/i,
      );
      await assert.rejects(
        () => queryWithParameters(
          db,
          `UPDATE strategy_template SET evidence_strength = 'repeated_observation' WHERE id = ?`,
          [saved.template.id],
        ),
        /CHECK|check constraint/i,
      );
      assert.equal(Number((await queryWithParameters(
        db,
        `SELECT guaranteed FROM strategy_template WHERE id = ?`,
        [saved.template.id],
      ))[0].guaranteed), 0);

      const extras = Array.from({ length: 400 }, () => randomUUID());
      for (let offset = 0; offset < extras.length; offset += 100) {
        const chunk = extras.slice(offset, offset + 100);
        await queryWithParameters(
          db,
          `INSERT INTO strategy_template (
            id, brand_id, owner_id, industry, sampling_condition, evidence_strength,
            failure_case, explanation, strategy_label, guaranteed, successes, created_at, updated_at
          ) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, 'single_observation', ?, ?, 'observation', 0, 1, ?, ?)").join(", ")}`,
          chunk.flatMap((id) => [id, otherBrand, outsider, "对照行业", "对照条件", "对照失败", "对照说明", time, time]),
        );
      }
      if (db.kind === "postgresql") await db.query("ANALYZE strategy_template");
      const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
      const listQuery = strategyTemplatesForBrandQuery(owner, brand);
      const plan = JSON.stringify(await queryWithParameters(db, explain + listQuery.sql, listQuery.values));
      assert.match(plan, /strategy_template_owner_idx/);
      if (db.kind === "postgresql") assert.doesNotMatch(plan, /Seq Scan on strategy_template/);
      const afterList = await listStrategyTemplates(db, owner, brand);
      assert.equal(afterList.templates.some((item) => item.industry === "对照行业"), false);
      assert.equal(await plans(), 0);
      console.log(`${kind} strategy template list uses strategy_template_owner_idx`);
    } finally {
      await ddl.cleanup();
      await fixture.cleanup();
    }
  });
}
