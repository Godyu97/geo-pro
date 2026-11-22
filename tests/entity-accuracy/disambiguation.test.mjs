import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  entityCorrectionBodySchema,
  entityCorrectionErrors,
  entityDisambiguationBodySchema,
} from "../../src/features/entity-accuracy/contracts.ts";
import {
  entityCorrectionListQuery,
  entityDisambiguationListQuery,
} from "../../src/features/entity-accuracy/dao.ts";
import {
  confirmEntityDisambiguation,
  listEntityRevisions,
  recordEntityCorrection,
} from "../../src/features/entity-accuracy/revisions.ts";
import { correctionStatus, sameNameConfusion } from "../../src/features/entity-accuracy/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";
const answerText = "夹具：同名公司被点名，不是监测样本。";

test("disambiguation and correction contracts keep the two statuses apart", async () => {
  assert.equal(entityCorrectionErrors.INVALID_INPUT, 400);
  assert.equal(entityCorrectionErrors.NOT_FOUND, 404);
  const observationId = randomUUID();
  const priorAnalysisId = randomUUID();
  const sameNameOnly = {
    observationId,
    priorAnalysisId,
    sameSurfaceName: true,
    confirmedDifferentEntity: false,
  };
  assert.equal(entityDisambiguationBodySchema.safeParse(sameNameOnly).success, true);
  assert.equal(entityDisambiguationBodySchema.safeParse({ ...sameNameOnly, modelConfirmed: true }).success, false);
  assert.equal(entityDisambiguationBodySchema.safeParse({ ...sameNameOnly, countAsTargetMention: false }).success, false);
  assert.equal(entityCorrectionBodySchema.safeParse({
    observationId,
    actionDone: true,
    retestStillWrong: true,
    effect: "resolved",
  }).success, false);
  assert.equal(sameNameConfusion({ sameSurfaceName: true, confirmedDifferentEntity: false }).countAsTargetMention, true);
  assert.equal(sameNameConfusion({ sameSurfaceName: true, confirmedDifferentEntity: true }).countAsTargetMention, false);
  assert.equal(correctionStatus({ actionDone: true, retestStillWrong: true }).action, "actioned");
  assert.equal(correctionStatus({ actionDone: true, retestStillWrong: true }).effect, "unresolved");
  assert.equal(correctionStatus({ actionDone: true, retestStillWrong: false }).effect, "pending_retest");
  const zh = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url), "utf8"));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url), "utf8"));
  assert.equal(zh.entityCorrections.actionHeading === zh.entityCorrections.effectHeading, false);
  assert.equal(en.entityCorrections.actionHeading === en.entityCorrections.effectHeading, false);
  assert.equal(Object.values(zh.entityCorrections).includes("已解决"), false);
  assert.equal(Object.values(en.entityCorrections).includes("Resolved"), false);
  assert.equal(zh.entityCorrections.effectUnresolved.includes("未解决"), true);
  assert.equal(en.entityCorrections.actionActioned === en.entityCorrections.effectUnresolved, false);
});

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clockFrom(stamps) {
  let index = 0;
  return () => stamps[Math.min(index++, stamps.length - 1)];
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

function recordingCache() {
  const deleted = [];
  return {
    deleted,
    cache: {
      driver: "memory",
      async get(key) {
        if (String(key).startsWith("evidence-overview:index:")) return { state: "hit", value: "{}" };
        return { state: "miss" };
      },
      async set() {
        return "stored";
      },
      async delete(key) {
        deleted.push(key);
      },
    },
  };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Entity revision owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function seedObservation(db, brandId, ownerId, observationId, analysisId, mentioned = "true") {
  await queryWithParameters(
    db,
    `INSERT INTO answer_observation (
      id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
      fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
      evidence_state, locator_ref, collector_id, missing_reason, created_at
    ) VALUES (?, ?, ?, NULL, NULL, 'consumer_ui', 'manual', ?, ?, ?, ?, 'CN', 'zh-CN', 'unknown', 1, 'complete', 'complete', NULL, NULL, NULL, ?)`,
    [observationId, brandId, ownerId, "夹具问题", answerText, fingerprint(observationId), time, time],
  );
  await queryWithParameters(
    db,
    `INSERT INTO answer_analysis_version (
      id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
      official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
    ) VALUES (?, ?, ?, 1, 1, 's-m0-06-v1', ?, 'false', 'false', '同名片段', 'classified', NULL, NULL, NULL, ?)`,
    [analysisId, observationId, brandId, mentioned, time],
  );
}

async function versions(db, observationId) {
  return queryWithParameters(
    db,
    `SELECT id, version, mentioned, status, revised_from AS "revisedFrom"
     FROM answer_analysis_version WHERE observation_id = ? ORDER BY version ASC`,
    [observationId],
  );
}

async function answerOf(db, observationId) {
  const [row] = await queryWithParameters(
    db,
    `SELECT answer_text AS "answerText" FROM answer_observation WHERE id = ?`,
    [observationId],
  );
  return row.answerText;
}

async function insertChunk(db, table, columns, rows) {
  const group = `(${columns.map(() => "?").join(", ")})`;
  for (let offset = 0; offset < rows.length; offset += 40) {
    const chunk = rows.slice(offset, offset + 40);
    await queryWithParameters(
      db,
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => group).join(", ")}`,
      chunk.flat(),
    );
  }
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: same-name confirmation appends a version and correction effect stays unresolved`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        assert.deepEqual(await structure(db), await structure(ddl.connection));
        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        await new BrandDao(db).insertBrand(owner, brand, time);
        const observationId = randomUUID();
        const priorId = randomUUID();
        const heldObservation = randomUUID();
        const heldAnalysis = randomUUID();
        await seedObservation(db, brand, owner, observationId, priorId);
        await seedObservation(db, brand, owner, heldObservation, heldAnalysis);
        const clock = clockFrom([
          "2026-11-22T08:00:01.000Z",
          "2026-11-22T08:00:02.000Z",
          "2026-11-22T08:00:03.000Z",
        ]);
        const base = {
          brandId: brand,
          observationId,
          priorAnalysisId: priorId,
        };
        for (const flags of [
          { sameSurfaceName: true, confirmedDifferentEntity: false },
          { sameSurfaceName: false, confirmedDifferentEntity: true },
          { sameSurfaceName: false, confirmedDifferentEntity: false },
        ]) {
          const rejectedCache = recordingCache();
          const rejectedWatch = watch(db);
          const rejected = await confirmEntityDisambiguation(
            rejectedWatch.connection,
            owner,
            { ...base, ...flags },
            clock,
            rejectedCache.cache,
          );
          assert.equal(rejected.error, "INVALID_INPUT");
          assert.equal(rejectedWatch.captured.some((item) => /INSERT INTO answer_analysis_version|INSERT INTO entity_disambiguation|UPDATE/i.test(item.sql)), false);
          assert.equal(rejectedCache.deleted.length, 0);
        }
        assert.equal((await versions(db, observationId)).length, 1);
        assert.equal((await versions(db, observationId))[0].mentioned, "true");
        assert.equal((await versions(db, observationId))[0].status, "classified");

        const hiddenCache = recordingCache();
        const hidden = await confirmEntityDisambiguation(db, outsider, {
          ...base,
          sameSurfaceName: true,
          confirmedDifferentEntity: true,
        }, clock, hiddenCache.cache);
        assert.equal(hidden.error, "NOT_FOUND");
        assert.equal(JSON.stringify(hidden).includes(priorId), false);
        assert.equal(JSON.stringify(hidden).includes(observationId), false);
        assert.equal(hiddenCache.deleted.length, 0);
        assert.equal((await versions(db, observationId)).length, 1);

        const stale = await confirmEntityDisambiguation(db, owner, {
          ...base,
          priorAnalysisId: heldAnalysis,
          sameSurfaceName: true,
          confirmedDifferentEntity: true,
        }, clock);
        assert.equal(stale.error, "INVALID_INPUT");
        const missingObservation = await confirmEntityDisambiguation(db, owner, {
          ...base,
          observationId: randomUUID(),
          sameSurfaceName: true,
          confirmedDifferentEntity: true,
        }, clock);
        assert.equal(missingObservation.error, "NOT_FOUND");
        const missingCorrection = await recordEntityCorrection(db, owner, {
          brandId: brand,
          observationId: randomUUID(),
          actionDone: true,
          retestStillWrong: true,
        }, clock);
        assert.equal(missingCorrection.error, "NOT_FOUND");
        assert.equal((await versions(db, observationId)).length, 1);

        const savedCache = recordingCache();
        const savedWatch = watch(db);
        const saved = await confirmEntityDisambiguation(savedWatch.connection, owner, {
          ...base,
          sameSurfaceName: true,
          confirmedDifferentEntity: true,
        }, clock, savedCache.cache);
        const decision = sameNameConfusion({ sameSurfaceName: true, confirmedDifferentEntity: true });
        assert.equal(saved.disambiguation.countAsTargetMention, decision.countAsTargetMention);
        assert.equal(saved.prior.id, priorId);
        assert.equal(saved.prior.mentioned, "true");
        assert.equal(saved.next.mentioned, "false");
        assert.equal(saved.next.version, 2);
        assert.equal("resolved" in saved.disambiguation, false);
        const updates = savedWatch.captured.filter((item) => /^\s*UPDATE/i.test(item.sql));
        assert.equal(updates.length, 1);
        assert.match(updates[0].sql, /status = 'revised'/);
        assert.equal(/mentioned/i.test(updates[0].sql), false);
        assert.equal(savedWatch.captured.some((item) => /report_snapshot|answer_observation/.test(item.sql) && /UPDATE/i.test(item.sql)), false);
        assert.equal(savedWatch.captured.some((item) => /report_snapshot/.test(item.sql)), false);
        assert.equal(savedCache.deleted.some((key) => key.startsWith("evidence-overview:index:")), true);
        const storedVersions = await versions(db, observationId);
        assert.equal(storedVersions.length, 2);
        assert.equal(storedVersions[0].id, priorId);
        assert.equal(storedVersions[0].mentioned, "true");
        assert.equal(storedVersions[0].status, "revised");
        assert.equal(storedVersions[1].id, saved.next.id);
        assert.equal(storedVersions[1].mentioned, "false");
        assert.equal(storedVersions[1].revisedFrom, priorId);
        assert.equal(await answerOf(db, observationId), answerText);
        const [disambiguation] = await queryWithParameters(
          db,
          `SELECT prior_analysis_id AS "priorAnalysisId", next_analysis_id AS "nextAnalysisId",
                  count_as_target_mention AS "countAsTargetMention"
           FROM entity_disambiguation WHERE id = ?`,
          [saved.disambiguation.id],
        );
        assert.equal(disambiguation.priorAnalysisId, priorId);
        assert.equal(disambiguation.nextAnalysisId, saved.next.id);
        assert.equal(Number(disambiguation.countAsTargetMention), 0);

        const correction = await recordEntityCorrection(db, owner, {
          brandId: brand,
          observationId,
          actionDone: true,
          retestStillWrong: true,
        }, clock);
        const expected = correctionStatus({ actionDone: true, retestStillWrong: true });
        assert.equal(correction.correction.action, "actioned");
        assert.equal(correction.correction.effect, "unresolved");
        assert.equal(correction.correction.action, expected.action);
        assert.equal(correction.correction.effect, expected.effect);
        assert.equal("resolved" in correction.correction, false);
        assert.equal("status" in correction.correction, false);
        assert.equal((await versions(db, observationId)).length, 2);
        assert.equal((await versions(db, observationId))[0].mentioned, "true");

        const waiting = await recordEntityCorrection(db, owner, {
          brandId: brand,
          observationId,
          actionDone: true,
          retestStillWrong: false,
        }, clock);
        assert.equal(waiting.correction.action, "actioned");
        assert.equal(waiting.correction.effect, "pending_retest");
        const correctionRows = await queryWithParameters(
          db,
          `SELECT id, action, effect FROM entity_correction WHERE brand_id = ? ORDER BY created_at ASC, id ASC`,
          [brand],
        );
        assert.equal(correctionRows.length, 2);
        assert.equal(correctionRows[0].id, correction.correction.id);
        assert.equal(correctionRows[0].action, "actioned");
        assert.equal(correctionRows[0].effect, "unresolved");

        const deniedCorrection = await recordEntityCorrection(db, outsider, {
          brandId: brand,
          observationId,
          actionDone: true,
          retestStillWrong: true,
        }, clock);
        assert.equal(deniedCorrection.error, "NOT_FOUND");
        assert.equal(JSON.stringify(deniedCorrection).includes(observationId), false);

        const listWatch = watch(db);
        const listed = await listEntityRevisions(listWatch.connection, owner, brand);
        assert.equal(listed.board.disambiguations[0].countAsTargetMention, false);
        assert.equal(listed.board.corrections[0].action, "actioned");
        assert.equal(listed.board.corrections[0].effect, "pending_retest");
        assert.equal(listed.board.corrections[1].effect, "unresolved");
        assert.equal(listWatch.captured.filter((item) => item.sql.includes("FROM entity_disambiguation")).length, 1);
        assert.equal(listWatch.captured.filter((item) => item.sql.includes("FROM entity_correction")).length, 1);
        assert.equal(listWatch.captured.some((item) => /count\s*\(/i.test(item.sql)), false);

        const heldNext = randomUUID();
        await queryWithParameters(
          db,
          `INSERT INTO answer_analysis_version (
            id, observation_id, brand_id, version, entity_version, rule_version, mentioned, recommended,
            official_site_cited, evidence_span, status, revised_from, reason, reviewer_id, created_at
          ) VALUES (?, ?, ?, 2, 1, 's-m0-06-v1', 'true', 'false', 'false', NULL, 'classified', NULL, NULL, NULL, ?)`,
          [heldNext, heldObservation, brand, "2026-11-22T08:00:06.000Z"],
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO entity_disambiguation (
              id, brand_id, owner_id, observation_id, prior_analysis_id, next_analysis_id,
              count_as_target_mention, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
            [randomUUID(), brand, owner, heldObservation, heldAnalysis, heldNext, time],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO entity_correction (
              id, brand_id, owner_id, observation_id, action, effect, created_at
            ) VALUES (?, ?, ?, ?, 'actioned', 'resolved', ?)`,
            [randomUUID(), brand, owner, heldObservation, "2026-11-22T08:00:04.000Z"],
          ),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO entity_correction (
              id, brand_id, owner_id, observation_id, action, effect, created_at
            ) VALUES (?, ?, ?, ?, 'actioned', 'open', ?)`,
            [randomUUID(), brand, owner, heldObservation, "2026-11-22T08:00:05.000Z"],
          ),
          /CHECK|check constraint/i,
        );

        const extraBrands = Array.from({ length: 200 }, () => randomUUID());
        await insertChunk(
          db,
          "brand",
          ["id", "owner_id", "status", "revision", "entity_version", "created_at"],
          extraBrands.map((id) => [id, outsider, "archived", 1, 1, time]),
        );
        const extraObservations = extraBrands.map((id) => ({ brandId: id, observationId: randomUUID(), priorId: randomUUID(), nextId: randomUUID() }));
        await insertChunk(
          db,
          "answer_observation",
          [
            "id", "brand_id", "owner_id", "slot_id", "attempt_id", "source_mode", "capture_method",
            "question_text", "answer_text", "fingerprint", "captured_at", "region", "language",
            "requested_network_mode", "entity_version", "citation_set_state", "evidence_state",
            "locator_ref", "collector_id", "missing_reason", "created_at",
          ],
          extraObservations.map((row) => [
            row.observationId, row.brandId, outsider, null, null, "consumer_ui", "manual",
            "夹具问题", answerText, fingerprint(row.observationId), time, "CN", "zh-CN",
            "unknown", 1, "complete", "complete", null, null, null, time,
          ]),
        );
        await insertChunk(
          db,
          "answer_analysis_version",
          [
            "id", "observation_id", "brand_id", "version", "entity_version", "rule_version", "mentioned",
            "recommended", "official_site_cited", "evidence_span", "status", "revised_from", "reason",
            "reviewer_id", "created_at",
          ],
          extraObservations.flatMap((row) => [
            [row.priorId, row.observationId, row.brandId, 1, 1, "s-m0-06-v1", "true", "false", "false", null, "revised", null, null, null, time],
            [row.nextId, row.observationId, row.brandId, 2, 1, "s-m0-06-v1", "false", "false", "false", null, "classified", row.priorId, "same_name_different_entity", outsider, time],
          ]),
        );
        await insertChunk(
          db,
          "entity_disambiguation",
          [
            "id", "brand_id", "owner_id", "observation_id", "prior_analysis_id", "next_analysis_id",
            "count_as_target_mention", "created_at",
          ],
          extraObservations.map((row) => [
            randomUUID(), row.brandId, outsider, row.observationId, row.priorId, row.nextId, 0, time,
          ]),
        );
        await insertChunk(
          db,
          "entity_correction",
          ["id", "brand_id", "owner_id", "observation_id", "action", "effect", "created_at"],
          extraObservations.map((row) => [
            randomUUID(), row.brandId, outsider, row.observationId, "actioned", "unresolved", time,
          ]),
        );
        if (db.kind === "postgresql") await db.query("ANALYZE entity_disambiguation, entity_correction");
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const disambiguationQuery = entityDisambiguationListQuery(owner, brand);
        const correctionQuery = entityCorrectionListQuery(owner, brand);
        const disambiguationPlan = JSON.stringify(await queryWithParameters(db, explain + disambiguationQuery.sql, disambiguationQuery.values));
        const correctionPlan = JSON.stringify(await queryWithParameters(db, explain + correctionQuery.sql, correctionQuery.values));
        assert.match(disambiguationPlan, /entity_disambiguation_owner_idx/);
        assert.match(correctionPlan, /entity_correction_owner_idx/);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
