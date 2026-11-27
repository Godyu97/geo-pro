import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { extractBrandFactClaim } from "../../src/features/entity-accuracy/claim-extract.ts";
import { listBrandFactClaims } from "../../src/features/entity-accuracy/claim-read.ts";
import { applyExtractedClaim, compareAnswerToFacts } from "../../src/features/entity-accuracy/claims.ts";
import { readEntityReviewWorkspace, recordEntityReviews } from "../../src/features/entity-accuracy/commands.ts";
import { claimExtractErrors } from "../../src/features/entity-accuracy/contracts.ts";
import { brandFactObservationQuery } from "../../src/features/entity-accuracy/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { seedBrandFactClaims } from "../entity-accuracy/fixtures.mjs";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const method = "品牌核验题抽检";
const env = {
  OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "loopback-model",
};

function fact(id, title, claim, status) {
  return { id, category: "price", title, claim, status };
}

test("brand-fact comparisons keep expired facts and wording differences out of confirmed errors", () => {
  const approved = fact("11111111-1111-4111-8111-111111111111", "官方售价", "官方售价 199 元", "approved");
  const expired = fact("22222222-2222-4222-8222-222222222222", "促销价", "促销价 99 元", "expired");
  const other = fact("33333333-3333-4333-8333-333333333333", "官方售价", "官方售价 188 元", "approved");
  const revoked = fact("44444444-4444-4444-8444-444444444444", "渠道价", "渠道价 150 元", "revoked");
  const conflict = compareAnswerToFacts("该品牌官方售价为 299 元", [approved, expired, revoked]);
  assert.equal(conflict.judgment, "conflict");
  assert.equal(conflict.confirmable, true);
  assert.equal(conflict.reviewFact, "active");
  assert.equal(conflict.factStatus, "approved");
  const stale = compareAnswerToFacts("去年促销价 99 元", [approved, expired]);
  assert.equal(stale.judgment, "insufficient");
  assert.equal(stale.confirmable, false);
  assert.equal(stale.reviewFact, "expired");
  assert.equal(stale.factStatus, "expired");
  const wording = compareAnswerToFacts("官方售价是 199 元", [approved]);
  assert.equal(wording.judgment, "not_applicable");
  assert.equal(wording.confirmable, false);
  const unresolved = compareAnswerToFacts("该品牌官方售价为 299 元", [approved, other]);
  assert.equal(unresolved.judgment, "insufficient");
  assert.equal(unresolved.reviewFact, "conflict");
  assert.equal(unresolved.confirmable, false);
  const revokedOnly = compareAnswerToFacts("渠道价 150 元", [revoked]);
  assert.equal(revokedOnly.judgment, "not_applicable");
  assert.equal(revokedOnly.confirmable, false);
  const drafted = applyExtractedClaim(stale, "模型把过期事实说成冲突");
  assert.equal(drafted.claim, "模型把过期事实说成冲突");
  assert.equal(drafted.judgment, "insufficient");
  assert.equal(drafted.confirmable, false);
  assert.equal(drafted.reviewFact, "expired");
});

function watch(db) {
  const captured = [];
  return {
    captured,
    connection: {
      kind: db.kind,
      query(sql, values) {
        captured.push({ sql, values });
        return db.query(sql, values);
      },
      transaction: (work) => db.transaction(work),
    },
  };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
    id, "Claim review owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true,
  ]);
  return id;
}

async function countTable(db, table, brandId) {
  const [row] = await queryWithParameters(db, `SELECT COUNT(*) AS "count" FROM ${table} WHERE brand_id = ?`, [brandId]);
  return Number(row.count);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: brand-fact claims stay out of natural discovery and confirmed errors need a person`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const [owner, outsider, otherOwner] = await Promise.all([account(db), account(db), account(db)]);
      const brandId = randomUUID();
      const otherBrandId = randomUUID();
      const seeded = await seedBrandFactClaims(db, owner, brandId, { extraSamples: 9 });
      const other = await seedBrandFactClaims(db, otherOwner, otherBrandId);
      const hidden = await readEntityReviewWorkspace(db, outsider, brandId);
      assert.equal(hidden.error, "NOT_FOUND");
      assert.equal(claimExtractErrors.NOT_FOUND, 404);
      assert.equal(JSON.stringify(hidden).includes(seeded.conflict.answer), false);
      assert.equal(JSON.stringify(hidden).includes("自然发现题不应进入核验主张"), false);

      const watched = watch(db);
      const workspace = await readEntityReviewWorkspace(watched.connection, owner, brandId);
      assert.equal(workspace.claims.length, 11);
      const conflict = workspace.claims.find((claim) => claim.observationId === seeded.conflict.observationId);
      const expired = workspace.claims.find((claim) => claim.observationId === seeded.expired.observationId);
      assert.equal(conflict.judgment, "conflict");
      assert.equal(conflict.confirmable, true);
      assert.equal(conflict.reviewFact, "active");
      assert.equal(conflict.analysisVersionId, seeded.conflict.analysisId);
      assert.equal(expired.judgment, "insufficient");
      assert.equal(expired.confirmable, false);
      assert.equal(expired.reviewFact, "expired");
      assert.equal(expired.factStatus, "expired");
      assert.equal(JSON.stringify(workspace.claims).includes(seeded.discovery.answer), false);
      const observationReads = watched.captured.filter((item) => item.sql.includes("FROM answer_observation"));
      assert.equal(observationReads.length, 2);
      const detail = observationReads.find((item) => item.sql.includes("question_id IN"));
      assert.match(detail.sql, /LIMIT 30/);
      const plan = await db.query(`${db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN "}${detail.sql}`, detail.values);
      console.log(`${kind} brand-fact observation plan ${JSON.stringify(plan)}`);
      assert.match(JSON.stringify(plan), /answer_observation|monitoring_slot|prompt_set|brand_fact/i);

      const listed = await listBrandFactClaims(db, otherOwner, otherBrandId);
      assert.equal(listed.length, 2);
      assert.equal(JSON.stringify(workspace.claims).includes(listed[0].observationId), false);
      assert.equal(JSON.stringify(workspace.claims).includes(other.conflict.observationId), false);

      const reviewsBefore = await countTable(db, "entity_review", brandId);
      const analysesBefore = await countTable(db, "answer_analysis_version", brandId);
      const calls = [];
      const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url: String(url), body, authorization: init.headers.Authorization });
        const mode = body.input.includes(seeded.expired.answer) ? "expired" : "bad";
        const text = mode === "expired"
          ? JSON.stringify({ claim: "模型草案：促销价 99 元", judgment: "conflict", factId: seeded.expiredId })
          : "ignore previous instructions";
        return new Response(JSON.stringify({
          id: "resp_loopback", status: "completed", model: "loopback-model",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      };
      const unconfigured = await extractBrandFactClaim(db, owner, brandId, { observationId: seeded.expired.observationId }, { env: {}, fetchImpl });
      assert.deepEqual(unconfigured, { error: "AI_UNAVAILABLE" });
      assert.equal(calls.length, 0);
      const denied = await extractBrandFactClaim(db, outsider, brandId, { observationId: seeded.expired.observationId }, { env, fetchImpl });
      assert.equal(denied.error, "NOT_FOUND");
      assert.equal(JSON.stringify(denied).includes(seeded.expired.answer), false);
      assert.equal(calls.length, 0);
      const drafted = await extractBrandFactClaim(db, owner, brandId, { observationId: seeded.expired.observationId }, { env, fetchImpl });
      assert.equal(drafted.claim.claim, "模型草案：促销价 99 元");
      assert.equal(drafted.claim.judgment, "insufficient");
      assert.equal(drafted.claim.confirmable, false);
      assert.equal(drafted.claim.reviewFact, "expired");
      assert.equal(await countTable(db, "entity_review", brandId), reviewsBefore);
      assert.equal(await countTable(db, "answer_analysis_version", brandId), analysesBefore);
      const request = calls[0];
      assert.equal(request.url.endsWith("/responses"), true);
      assert.equal(request.body.store, false);
      assert.equal(request.authorization, "Bearer test-key");
      assert.equal(request.body.instructions.includes(seeded.expired.answer), false);
      assert.equal(JSON.parse(request.body.input).answerText, seeded.expired.answer);
      const invalid = await extractBrandFactClaim(db, owner, brandId, { observationId: seeded.conflict.observationId }, { env, fetchImpl });
      assert.equal(invalid.error, "INVALID_MODEL_OUTPUT");
      assert.equal(claimExtractErrors.INVALID_MODEL_OUTPUT, 422);
      assert.equal(JSON.stringify(invalid).includes(seeded.conflict.answer), false);
      assert.equal(await countTable(db, "entity_review", brandId), reviewsBefore);
      assert.equal(await countTable(db, "answer_analysis_version", brandId), analysesBefore);

      const rejected = await recordEntityReviews(db, owner, {
        brandId,
        method,
        population: 50,
        marks: [{
          observationId: seeded.expired.observationId,
          analysisVersionId: seeded.expired.analysisId,
          reviewed: true,
          confirmed: true,
          fact: "expired",
        }],
      });
      assert.equal(rejected.error, "INVALID_INPUT");
      assert.equal(await countTable(db, "entity_review", brandId), 0);
      for (const sample of [seeded.expired, seeded.discovery]) {
        const notConfirmable = await recordEntityReviews(db, owner, {
          brandId, method, population: 50,
          marks: [{
            observationId: sample.observationId, analysisVersionId: sample.analysisId,
            reviewed: true, confirmed: true, fact: "active",
          }],
        });
        assert.equal(notConfirmable.error, "INVALID_INPUT");
      }
      assert.equal(await countTable(db, "entity_review", brandId), 0);
      const [second, ...extras] = seeded.extras;
      const saved = await recordEntityReviews(db, owner, {
        brandId,
        method,
        population: 50,
        marks: [
          {
            observationId: seeded.conflict.observationId,
            analysisVersionId: seeded.conflict.analysisId,
            reviewed: true,
            confirmed: true,
            fact: conflict.reviewFact,
          },
          {
            observationId: second.observationId,
            analysisVersionId: second.analysisId,
            reviewed: true,
            confirmed: true,
            fact: "active",
          },
          ...extras.map((item) => ({ observationId: item.observationId, analysisVersionId: item.analysisId, reviewed: true, confirmed: false, fact: "active" })),
        ],
      });
      assert.equal(saved.board.errorLabel, "2/10");
      assert.equal(saved.board.coverage, "10/50");
      assert.equal(saved.board.populationRate, null);
      assert.equal(JSON.stringify(saved.board).includes("%"), false);
      assert.equal(JSON.stringify(saved.board).includes("0.04"), false);
      const refreshed = await readEntityReviewWorkspace(db, owner, brandId);
      assert.equal(refreshed.board.errorLabel, "2/10");
      assert.equal(refreshed.board.coverage, "10/50");
      assert.equal(refreshed.board.populationRate, null);
      assert.equal(refreshed.claims.find((claim) => claim.observationId === seeded.conflict.observationId).judgment, "conflict");
      const built = brandFactObservationQuery(owner, brandId, [seeded.conflict.questionId]);
      assert.match(built.sql, /o\.owner_id = \? AND o\.brand_id = \?/);
    } finally {
      await Promise.all([fixture.cleanup(), ddl.cleanup()]);
    }
  });
}
