import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { exportScopes } from "../../src/features/data-exports/contracts.ts";
import { prepareExport, readExportFile } from "../../src/features/data-exports/service.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-20T03:00:00.000Z";
const fields = { ...initialBrandFields, name: "合成品牌 🚀", description: "合成导出验收资料" };
const fingerprint = "a".repeat(64);

function observe(connection) {
  const queries = [];
  const wrap = (current) => ({
    ...current,
    query(sql, values) {
      queries.push(sql);
      return current.query(sql, values);
    },
    transaction(work) {
      return current.transaction((tx) => work(wrap(tx)));
    },
    savepoint(work) {
      return current.savepoint((inner) => work(wrap(inner)));
    },
  });
  return { connection: wrap(connection), queries };
}

async function ownerAndBrand(db, email) {
  const ownerId = randomUUID();
  const brandId = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [ownerId, "测试负责人 🚀", email]);
  const brands = new BrandDao(db);
  await brands.insertBrand(ownerId, brandId, time);
  await brands.insertVersion(brandId, 1, fields, time);
  return { ownerId, brandId };
}

test("delivered export scopes are a closed, unique set", () => {
  assert.equal(new Set(exportScopes).size, exportScopes.length);
  assert.equal(exportScopes.includes("factsAndMaterials"), true);
  assert.equal(exportScopes.includes("usageAndCosts"), true);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: delivered domains keep source values and page in batches`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const sql = (query, params) => queryWithParameters(db, query, params);
    const owner = await ownerAndBrand(db, "owner@example.invalid");
    const frozen = await ownerAndBrand(db, "frozen@example.invalid");
    const other = await ownerAndBrand(db, "other@example.invalid");
    await sql("UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ?", [time, time, frozen.brandId]);
    await sql(`INSERT INTO brand_fact_paste (brand_id, id, previous_id, original, created_at) VALUES
      (?, 'owned-a', NULL, ?, ?), (?, 'owned-b', 'owned-a', '事实续写', ?),
      (?, 'frozen-a', NULL, 'FROZEN-FACT', ?), (?, 'other-a', NULL, 'FOREIGN-FACT', ?)`,
    [owner.brandId, "事实原文 🚀", time, owner.brandId, time, frozen.brandId, time, other.brandId, time]);
    await sql(`INSERT INTO brand_fact_version
      (brand_id, id, fact_id, version, entity_version, paste_id, revision, state, content, created_at, confirmed_by, confirmed_at, revoked_at)
      VALUES (?, 'fact-v1', 'fact-1', 1, 1, 'owned-a', 1, 'draft', '事实正文 🚀', ?, NULL, NULL, NULL)`,
    [owner.brandId, time]);
    await sql(`INSERT INTO brand_fact_use (brand_id, fact_version_id, content_version_id, stage) VALUES (?, 'fact-v1', ?, 'review')`,
      [owner.brandId, randomUUID()]);
    await sql(`INSERT INTO monitoring_run
      (id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version, repeat_count,
       question_count, natural_count, channel_count, slot_count, region, language, requested_network_mode,
       currency, upper_minor, estimate_high_minor, customer_payable_minor, status, sampling_complete, created_at)
      VALUES (?, ?, ?, ?, 'run-fp', 'consumer_ui', ?, 1, 1, 1, 0, 1, 1, 'CN', 'zh-CN', 'off',
        NULL, NULL, NULL, 0, 'succeeded', 1, ?)`,
    [randomUUID(), owner.brandId, owner.ownerId, randomUUID(), randomUUID(), time]);
    const observationId = randomUUID();
    await sql(`INSERT INTO answer_observation
      (id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text, fingerprint,
       captured_at, region, language, requested_network_mode, entity_version, citation_set_state, evidence_state,
       locator_ref, collector_id, missing_reason, created_at, target_region, observed_region, new_session, product_mode)
      VALUES (?, ?, ?, NULL, NULL, 'model_api', 'official_api', '问题原文 🚀', '回答原文 🚀', ?, ?, 'CN', 'zh-CN',
        'off', 1, 'missing', 'complete', NULL, NULL, NULL, ?, 'CN', 'unknown', 'unknown', 'unknown')`,
    [observationId, owner.brandId, owner.ownerId, fingerprint, time, time]);
    await sql(`INSERT INTO answer_citation
      (id, observation_id, brand_id, raw_url, normalized_url, citation_origin, position_label, ownership, page_status, created_at)
      VALUES (?, ?, ?, 'https://example.invalid/路径', 'https://example.invalid/路径', 'provider_native', NULL, 'owned_domain', 'unknown', ?)`,
    [randomUUID(), observationId, owner.brandId, time]);
    const findingId = randomUUID();
    const taskId = randomUUID();
    await sql(`INSERT INTO optimization_finding
      (id, brand_id, owner_id, gap_type, question_cluster, target_page, observation_id, analysis_version_id,
       evidence_summary, problem_statement, hypothesis, assumption_level, steps_json, completion_criteria, retest_method,
       business_importance, estimated_effort, verified_evidence, privacy_risk, created_at)
      VALUES (?, ?, ?, 'citation_gap', '购买问题', 'https://example.invalid/p', NULL, NULL,
        'evidence', '问题陈述', '假设', 'verified', '["check"]', '完成标准', '复测', 1, 1, 1, 0, ?)`,
    [findingId, owner.brandId, owner.ownerId, time]);
    await sql(`INSERT INTO optimization_task
      (id, brand_id, owner_id, primary_finding_id, gap_type, question_cluster, target_page, title, status, priority_bucket,
       manual_rank, reorder_reason, completion_note, dismiss_reason, retest_conclusion, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'citation_gap', '购买问题', 'https://example.invalid/p', '优化标题 🚀', 'todo', 'normal',
        NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    [taskId, owner.brandId, owner.ownerId, findingId, time, time]);
    await sql(`INSERT INTO content_plan (id, brand_id, owner_id, question_cluster, coverage_json, created_at, updated_at)
      VALUES (?, ?, ?, 'cluster', ?, ?, ?)`, [randomUUID(), owner.brandId, owner.ownerId, '{"gap":"citation"}', time, time]);
    await sql(`INSERT INTO content_asset
      (id, brand_id, owner_id, kind, source, rights_statement, visibility, review_status, content_ref, fingerprint, created_at)
      VALUES (?, ?, ?, 'cover', 'owner', 'rights', 'public', 'approved', 'public-ref', 'fp', ?),
             (?, ?, ?, 'cover', 'owner', 'rights', 'internal', 'pending', 'secret-internal-attachment', 'fp', ?)`,
    [randomUUID(), owner.brandId, owner.ownerId, time, randomUUID(), owner.brandId, owner.ownerId, time]);
    await sql(`INSERT INTO report_retest
      (id, brand_id, owner_id, kind, status, intent, track, timezone, entity_version, before_run_id, after_run_id,
       publication_id, effective_at, operation_id, comparison_json, block_reason, created_at, updated_at)
      VALUES (?, ?, ?, 'exploratory', 'scheduled', 'diagnostic', 'model_api', 'Asia/Shanghai', 1, NULL, NULL,
        NULL, NULL, ?, NULL, NULL, ?, ?)`,
    [randomUUID(), owner.brandId, owner.ownerId, randomUUID(), time, time]);
    const reservationId = randomUUID();
    await sql(`INSERT INTO quota_grant
      (brand_id, kind, version, operation_id, fingerprint, actor_id, reason, count_limit, budget_minor, currency, expires_at, changed_at, action)
      VALUES (?, 'sampling', 1, ?, 'fp', ?, 'pilot', 2, 100, 'CNY', ?, ?, 'set')`,
    [owner.brandId, randomUUID(), owner.ownerId, time, time]);
    await sql(`INSERT INTO quota_reservation
      (brand_id, kind, id, grant_version, upper_minor, state, created_at, finalized_at)
      VALUES (?, 'sampling', ?, 1, 40, 'reserved', ?, NULL)`, [owner.brandId, reservationId, time]);
    await sql(`INSERT INTO quota_attempt
      (brand_id, kind, reservation_id, id, upper_minor, actual_minor, state, started_at, reconciled_at)
      VALUES (?, 'sampling', ?, ?, 40, NULL, 'pending', ?, NULL)`, [owner.brandId, reservationId, randomUUID(), time]);

    const ready = (await prepareExport(db, owner.ownerId, {
      actorId: owner.ownerId, previousId: null, locale: "en", scopes: [...exportScopes],
    })).summary;
    assert.equal(ready.status, "ready");
    assert.deepEqual(ready.missing, []);
    const file = await readExportFile(db, owner.ownerId, ready.id, true);
    const body = JSON.parse(file.body);
    assert.deepEqual(body.unavailable, []);
    assert.equal(body.locale, "en");
    assert.equal(body.data.factsAndMaterials.pastes.find((row) => row.id === "owned-a").original, "事实原文 🚀");
    assert.equal(body.data.factsAndMaterials.versions[0].content, "事实正文 🚀");
    assert.equal(body.data.monitoringAndEvidence.runs[0].language, "zh-CN");
    assert.equal(body.data.monitoringAndEvidence.runs[0].region, "CN");
    assert.equal(body.data.monitoringAndEvidence.observations[0].answerText, "回答原文 🚀");
    assert.equal(body.data.monitoringAndEvidence.citations[0].rawUrl, "https://example.invalid/路径");
    assert.equal(body.data.monitoringAndEvidence.tasks[0].title, "优化标题 🚀");
    assert.equal(body.data.content.assets.length, 1);
    assert.equal(body.data.content.assets[0].contentRef, "public-ref");
    assert.equal(body.data.reports.retests[0].timezone, "Asia/Shanghai");
    assert.equal(body.data.usageAndCosts.grants[0].budgetMinor, 100);
    assert.equal(body.data.usageAndCosts.grants[0].currency, "CNY");
    assert.equal(body.data.usageAndCosts.attempts[0].upperMinor, 40);
    assert.equal(body.data.usageAndCosts.attempts[0].actualMinor, null);
    assert.doesNotMatch(file.body, /FROZEN-FACT|FOREIGN-FACT|secret-internal-attachment|maintenance_audit/);
    assert.equal(await readExportFile(db, owner.ownerId, ready.id, false), null);

    const extra = Array.from({ length: 69 }, (_, index) => `page-${index}`);
    await sql(`INSERT INTO brand_fact_paste (brand_id, id, previous_id, original, created_at) VALUES
      ${extra.map(() => "(?, ?, NULL, 'page', ?)").join(", ")}`,
    extra.flatMap((id) => [owner.brandId, id, time]));
    const traced = observe(db);
    const paged = (await prepareExport(traced.connection, owner.ownerId, {
      actorId: owner.ownerId, previousId: ready.id, locale: "zh-CN", scopes: ["factsAndMaterials"],
    })).summary;
    assert.equal(paged.status, "ready");
    const pasteQueries = traced.queries.filter((query) => query.includes("brand_fact_paste"));
    assert.equal(pasteQueries.length, 2);
    const exported = JSON.parse((await readExportFile(db, owner.ownerId, paged.id, true)).body);
    assert.equal(exported.data.factsAndMaterials.pastes.length, 71);
    if (kind === "postgresql") await db.query("ANALYZE brand, brand_fact_paste");
    const plan = await db.transaction(async (tx) => {
      if (kind === "postgresql") await tx.query("SET LOCAL enable_seqscan = off");
      const explain = kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
      return tx.query(explain + pasteQueries[0], [owner.ownerId, 64]);
    });
    assert.match(JSON.stringify(plan), /brand_fact_paste|fact_paste|brand_owner_status_created_idx|brand_active_owner_uidx/);
    console.log(`${kind} fact paste export uses ${pasteQueries.length} SQL for 71 rows; plan ${JSON.stringify(plan)}`);

    let current = paged;
    await db.query("ALTER TABLE brand_fact_version RENAME TO brand_fact_version_test_closed");
    try {
      current = (await prepareExport(db, owner.ownerId, {
        actorId: owner.ownerId, previousId: current.id, locale: "zh-CN", scopes: ["profile", "factsAndMaterials"],
      })).summary;
      assert.equal(current.status, "partial");
      assert.deepEqual(current.missing, ["factsAndMaterials"]);
      assert.equal(JSON.parse((await readExportFile(db, owner.ownerId, current.id, true)).body).data.factsAndMaterials, undefined);
    } finally {
      await db.query("ALTER TABLE brand_fact_version_test_closed RENAME TO brand_fact_version");
    }

    await sql("UPDATE brand_fact_paste SET original = ? WHERE brand_id = ? AND id = 'owned-a'", ["x".repeat(8 * 1024 * 1024 + 64), owner.brandId]);
    const previous = (await prepareExport(db, owner.ownerId, {
      actorId: owner.ownerId, previousId: current.id, locale: "zh-CN", scopes: ["profile"],
    })).summary;
    const oversized = (await prepareExport(db, owner.ownerId, {
      actorId: owner.ownerId, previousId: previous.id, locale: "zh-CN", scopes: ["profile", "factsAndMaterials"],
    })).summary;
    assert.equal(oversized.status, "partial");
    assert.deepEqual(oversized.missing, ["factsAndMaterials"]);
    assert.equal(await readExportFile(db, other.ownerId, oversized.id, true), null);
    assert.equal(JSON.parse((await readExportFile(db, owner.ownerId, oversized.id, false)).body).data.profile.email, "owner@example.invalid");
  });
}
