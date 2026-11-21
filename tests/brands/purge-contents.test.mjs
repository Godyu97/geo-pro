import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { brandPurgeSteps } from "../../src/features/brands/purge-steps.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { purgeDueBrands, retryBrandPurge } from "../../src/features/brands/purge.ts";
import { prepareExport, readExportFile } from "../../src/features/data-exports/service.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const before = "2026-11-01T00:00:00.000Z";
const frozenAt = "2026-11-02T00:00:00.000Z";
const dueAt = "2026-12-02T00:00:00.000Z";
const fields = { ...initialBrandFields, name: "清除合成品牌", description: "含优化任务的合成正文" };

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: purge removes optimization tasks and fact chains without a foreign-key failure`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const sql = (query, params) => queryWithParameters(db, query, params);
    const ownerId = randomUUID();
    const brandId = randomUUID();
    const findingId = randomUUID();
    const taskId = randomUUID();
    await sql('INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [ownerId, "清除负责人", `${ownerId}@example.invalid`]);
    const brands = new BrandDao(db);
    await brands.insertBrand(ownerId, brandId, before);
    await brands.insertVersion(brandId, 1, fields, before);
    await sql(`INSERT INTO brand_fact_paste (brand_id, id, previous_id, original, created_at) VALUES
      (?, 'paste-a', NULL, '链首正文', ?), (?, 'paste-b', 'paste-a', '链尾正文', ?)`,
    [brandId, before, brandId, before]);
    await sql(`INSERT INTO brand_fact_version
      (brand_id, id, fact_id, version, entity_version, paste_id, revision, state, content, created_at, confirmed_by, confirmed_at, revoked_at)
      VALUES (?, 'fact-v', 'fact-1', 1, 1, 'paste-a', 1, 'draft', '事实正文', ?, NULL, NULL, NULL)`, [brandId, before]);
    await sql(`INSERT INTO optimization_finding
      (id, brand_id, owner_id, gap_type, question_cluster, target_page, observation_id, analysis_version_id,
       evidence_summary, problem_statement, hypothesis, assumption_level, steps_json, completion_criteria, retest_method,
       business_importance, estimated_effort, verified_evidence, privacy_risk, created_at)
      VALUES (?, ?, ?, 'page_unreadable', '问题簇', 'https://example.invalid/page', NULL, NULL,
        'summary', 'problem', 'hypothesis', 'observed_absence', '["look"]', 'done', 'retest', 2, 2, 0, 0, ?)`,
    [findingId, brandId, ownerId, before]);
    await sql(`INSERT INTO optimization_task
      (id, brand_id, owner_id, primary_finding_id, gap_type, question_cluster, target_page, title, status, priority_bucket,
       manual_rank, reorder_reason, completion_note, dismiss_reason, retest_conclusion, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'page_unreadable', '问题簇', 'https://example.invalid/page', '页面任务', 'todo', 'urgent',
        NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    [taskId, brandId, ownerId, findingId, before, before]);
    await sql(`INSERT INTO optimization_task_evidence (task_id, finding_id, brand_id, created_at) VALUES (?, ?, ?, ?)`,
      [taskId, findingId, brandId, before]);
    await sql(`INSERT INTO page_check_record
      (id, brand_id, owner_id, task_id, url, normalized_url, checked_at, access_condition, public_status, title, body_excerpt,
       key_facts_json, discoverability_notes, contains_executable_instructions, manual_evidence_ref, created_at)
      VALUES (?, ?, ?, ?, 'https://example.invalid/page', 'https://example.invalid/page', ?, 'public', 'reachable',
        NULL, NULL, '[]', 'notes', 0, NULL, ?)`,
    [randomUUID(), brandId, ownerId, taskId, before, before]);
    await sql(`INSERT INTO monitoring_run
      (id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version, repeat_count,
       question_count, natural_count, channel_count, slot_count, region, language, requested_network_mode,
       currency, upper_minor, estimate_high_minor, customer_payable_minor, status, sampling_complete, created_at)
      VALUES (?, ?, ?, ?, 'run-fp', 'consumer_ui', ?, 1, 1, 1, 0, 1, 1, 'CN', 'zh-CN', 'unknown',
        NULL, NULL, NULL, 0, 'cancelled', 1, ?)`,
    [randomUUID(), brandId, ownerId, randomUUID(), randomUUID(), before]);

    const exported = (await prepareExport(db, ownerId, {
      actorId: ownerId, previousId: null, locale: "zh-CN", scopes: ["factsAndMaterials", "monitoringAndEvidence"],
    })).summary;
    await sql("UPDATE user_data_export SET created_at = ? WHERE owner_id = ?", [before, ownerId]);
    await sql("UPDATE brand SET frozen_at = ?, restore_until = ?, revision = revision + 1 WHERE id = ?", [frozenAt, dueAt, brandId]);

    const first = await purgeDueBrands(db, { limit: 1 }, () => dueAt);
    assert.equal(first.results[0].status, "cleared");
    assert.deepEqual(first.results[0].remaining, []);
    for (const table of [
      "optimization_task", "optimization_task_evidence", "optimization_finding", "page_check_record",
      "brand_fact_paste", "brand_fact_version", "brand_version", "monitoring_run", "brand",
    ]) assert.equal(Number((await db.query(`SELECT count(*) AS n FROM ${table}`))[0].n), 0, table);
    assert.equal(await readExportFile(db, ownerId, exported.id, true), null);
    const receipt = await sql("SELECT step, issue FROM brand_purge WHERE brand_id = ?", [brandId]);
    assert.equal(receipt[0].step, brandPurgeSteps.length);
    assert.equal(receipt[0].issue, null);
    assert.equal((await retryBrandPurge(db, { ownerId, brandId }, () => dueAt)).status, "cleared");
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM brand_purged_cost"))[0].n), 0);
  });
}
