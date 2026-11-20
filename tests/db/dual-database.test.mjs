import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { ContentDao } from "../../src/features/content/dao.ts";
import { EvidenceDao } from "../../src/features/evidence/dao.ts";
import { OptimizationDao } from "../../src/features/optimization/dao.ts";
import { ReportDao } from "../../src/features/reports/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const fingerprint = "a".repeat(64);
const fields = {
  name: "合成品牌", description: "Synthetic dual-database fixture", website: "", aliases: [],
  region: "CN", language: "zh-CN", competitors: [], questions: [],
};

function journal(kind) {
  return JSON.parse(readFileSync(kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json", "utf8"));
}

function stamp(index) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
}

function normalize(value) {
  return JSON.stringify(value).replace(/\\[nt]|\s+/g, "").replace(/`/g, '"');
}

function migrate(env) {
  execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
}

async function tableCount(connection) {
  const rows = connection.kind === "postgresql"
    ? await connection.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
    : await connection.query("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'");
  return Number(rows[0].count);
}

async function insertRows(connection, table, columns, rows) {
  for (let offset = 0; offset < rows.length; offset += 40) {
    const chunk = rows.slice(offset, offset + 40);
    await queryWithParameters(
      connection,
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ")}`,
      chunk.flat(),
    );
  }
}

function trace(connection) {
  const queries = [];
  const wrap = (current) => ({
    ...current,
    query(sql, values) {
      queries.push({ sql, values: values ?? [] });
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

async function plansFor(connection, captured) {
  const prefix = connection.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
  if (connection.kind === "postgresql") {
    await connection.query("ANALYZE answer_observation, answer_analysis_version, optimization_task, content_plan, report_snapshot");
  }
  const natural = await connection.query(prefix + captured.sql, captured.values);
  if (connection.kind !== "postgresql") return { natural, indexed: natural };
  const indexed = await connection.transaction(async (tx) => {
    await tx.query("SET LOCAL enable_seqscan = off");
    return tx.query(prefix + captured.sql, captured.values);
  });
  return { natural, indexed };
}

async function account(connection) {
  const id = randomUUID();
  await queryWithParameters(connection, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "Synthetic owner", `${id}@example.invalid`]);
  return id;
}

async function brandFor(connection, ownerId) {
  const brandId = randomUUID();
  const brands = new BrandDao(connection);
  await brands.insertBrand(ownerId, brandId, stamp(0));
  await brands.insertVersion(brandId, 1, fields, stamp(0));
  return brandId;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: old migration upgrades, remigrates idempotently and matches full DDL`, async () => {
    const baseline = journal(kind).entries[4].tag;
    const upgraded = await testDatabase(kind, { migrateNow: false });
    try {
      await migrateThrough(upgraded.connection, baseline);
      const midTables = await tableCount(upgraded.connection);
      migrate(upgraded.env);
      const head = await structure(upgraded.connection);
      const headTables = await tableCount(upgraded.connection);
      assert.ok(headTables > midTables, `${kind} upgrade should add tables after ${baseline}`);
      migrate(upgraded.env);
      assert.equal(normalize(await structure(upgraded.connection)), normalize(head));
      const fresh = await testDatabase(kind);
      const imported = await testDatabase(kind, { ddl: true });
      try {
        const freshStructure = normalize(await structure(fresh.connection));
        assert.equal(freshStructure, normalize(await structure(imported.connection)));
        assert.equal(freshStructure, normalize(head));
        console.log(JSON.stringify({ event: "dual-db-upgrade", kind, baseline, midTables, headTables }));
      } finally {
        await fresh.cleanup();
        await imported.cleanup();
      }
    } finally {
      await upgraded.cleanup();
    }
  });

  test(`${kind}: representative M0 lists stay one statement and can use indexes`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    if (kind === "sqlite") assert.equal((await db.query("PRAGMA foreign_keys"))[0].foreign_keys, 1);
    const ownerId = await account(db);
    const brandId = await brandFor(db, ownerId);
    const otherOwnerId = await account(db);
    const otherBrandId = await brandFor(db, otherOwnerId);
    const modelIds = Array.from({ length: 200 }, () => randomUUID());
    const consumerIds = Array.from({ length: 40 }, () => randomUUID());
    const otherIds = Array.from({ length: 40 }, () => randomUUID());
    const observationRows = [
      ...modelIds.map((id, index) => [id, brandId, ownerId, "model_api", "official_api", "合成问题", "合成回答", fingerprint, stamp(index), "CN", "zh-CN", "unknown", 1, "complete", "complete", stamp(index)]),
      ...consumerIds.map((id, index) => [id, brandId, ownerId, "consumer_ui", "manual", "合成问题", "合成回答", fingerprint, stamp(300 + index), "CN", "zh-CN", "unknown", 1, "complete", "complete", stamp(300 + index)]),
      ...otherIds.map((id, index) => [id, otherBrandId, otherOwnerId, "model_api", "official_api", "其他问题", "其他回答", fingerprint, stamp(400 + index), "CN", "zh-CN", "unknown", 1, "complete", "complete", stamp(400 + index)]),
    ];
    await insertRows(db, "answer_observation", [
      "id", "brand_id", "owner_id", "source_mode", "capture_method", "question_text", "answer_text", "fingerprint",
      "captured_at", "region", "language", "requested_network_mode", "entity_version", "citation_set_state", "evidence_state", "created_at",
    ], observationRows);
    await insertRows(db, "answer_analysis_version", [
      "id", "observation_id", "brand_id", "version", "entity_version", "rule_version", "mentioned", "recommended", "official_site_cited", "status", "created_at",
    ], modelIds.map((id) => [randomUUID(), id, brandId, 1, 1, "s-m0-06-v1", "true", "false", "unknown", "classified", stamp(0)]));

    const findingIds = Array.from({ length: 160 }, () => randomUUID());
    const taskIds = Array.from({ length: 160 }, () => randomUUID());
    await insertRows(db, "optimization_finding", [
      "id", "brand_id", "owner_id", "gap_type", "question_cluster", "target_page", "evidence_summary", "problem_statement",
      "hypothesis", "assumption_level", "steps_json", "completion_criteria", "retest_method", "business_importance",
      "estimated_effort", "verified_evidence", "privacy_risk", "created_at",
    ], findingIds.map((id, index) => [
      id, index < 130 ? brandId : otherBrandId, index < 130 ? ownerId : otherOwnerId, "citation_gap", `cluster-${index}`,
      "https://example.invalid/page", "synthetic", "synthetic", "synthetic", "observed_absence", "[]", "visible", "same-track",
      2, 2, 0, 0, stamp(index),
    ]));
    await insertRows(db, "optimization_task", [
      "id", "brand_id", "owner_id", "primary_finding_id", "gap_type", "question_cluster", "target_page", "title", "status", "priority_bucket", "created_at", "updated_at",
    ], taskIds.map((id, index) => [
      id, index < 130 ? brandId : otherBrandId, index < 130 ? ownerId : otherOwnerId, findingIds[index], "citation_gap", `cluster-${index}`,
      "https://example.invalid/page", "synthetic task", "todo", "normal", stamp(index), stamp(index),
    ]));

    const planIds = Array.from({ length: 160 }, () => randomUUID());
    await insertRows(db, "content_plan", [
      "id", "brand_id", "owner_id", "question_cluster", "coverage_json", "created_at", "updated_at",
    ], planIds.map((id, index) => [
      id, index < 130 ? brandId : otherBrandId, index < 130 ? ownerId : otherOwnerId, `plan-${index}`, '{"covered":false}', stamp(index), stamp(index),
    ]));

    const retestIds = Array.from({ length: 80 }, () => randomUUID());
    const snapshotIds = Array.from({ length: 80 }, () => randomUUID());
    await insertRows(db, "report_retest", [
      "id", "brand_id", "owner_id", "kind", "status", "intent", "track", "timezone", "entity_version", "operation_id", "created_at", "updated_at",
    ], retestIds.map((id, index) => [
      id, index < 60 ? brandId : otherBrandId, index < 60 ? ownerId : otherOwnerId, "exploratory", "completed", "diagnostic",
      "model_api", "Asia/Shanghai", 1, randomUUID(), stamp(index), stamp(index),
    ]));
    await insertRows(db, "report_snapshot", [
      "id", "brand_id", "owner_id", "retest_id", "status", "grade", "intent", "loop_completed", "entity_version", "timezone", "locale",
      "source_missing", "json_bytes", "html_bytes", "json_sha256", "html_sha256", "operation_id", "created_at",
    ], snapshotIds.map((id, index) => [
      id, index < 60 ? brandId : otherBrandId, index < 60 ? ownerId : otherOwnerId, retestIds[index], "created", "exploratory", "diagnostic",
      0, 1, "Asia/Shanghai", "zh-CN", 0, "{}", "<p>synthetic</p>", fingerprint, fingerprint, randomUUID(), stamp(index),
    ]));

    const traced = trace(db);
    const started = performance.now();
    traced.queries.length = 0;
    const observations = await new EvidenceDao(traced.connection).listScopedObservations({ ownerId, brandId, sourceMode: "model_api" });
    assert.equal(traced.queries.length, 1);
    assert.equal(observations.length, 200);
    assert.equal(observations[0].observation.id, modelIds[199]);
    assert.equal(observations.at(-1).observation.id, modelIds[0]);
    const observationPlan = await plansFor(db, traced.queries[0]);

    traced.queries.length = 0;
    const tasks = await new OptimizationDao(traced.connection).listTasks({ ownerId, brandId, limit: 20 });
    assert.equal(traced.queries.length, 1);
    assert.equal(tasks.length, 20);
    assert.equal(tasks[0].id, taskIds[129]);
    const taskPlan = await plansFor(db, traced.queries[0]);

    traced.queries.length = 0;
    const plans = await new ContentDao(traced.connection).listPlans(ownerId, brandId, 20);
    assert.equal(traced.queries.length, 1);
    assert.equal(plans.length, 20);
    assert.equal(plans[0].id, planIds[129]);
    const planPlan = await plansFor(db, traced.queries[0]);

    traced.queries.length = 0;
    const snapshots = await new ReportDao(traced.connection).listSnapshots(ownerId, brandId, 20);
    assert.equal(traced.queries.length, 1);
    assert.equal(snapshots.length, 20);
    assert.equal(snapshots[0].id, snapshotIds[59]);
    const snapshotPlan = await plansFor(db, traced.queries[0]);

    const elapsedMs = Number((performance.now() - started).toFixed(1));
    const indexed = {
      observation: observationPlan.indexed,
      task: taskPlan.indexed,
      plan: planPlan.indexed,
      snapshot: snapshotPlan.indexed,
    };
    assert.match(JSON.stringify(indexed.observation), /answer_observation_(owner_idx|brand_idx|slot_uidx)/);
    assert.match(JSON.stringify(indexed.task), /optimization_task_(owner_idx|brand_status_idx|open_dedupe_uidx)/);
    assert.match(JSON.stringify(indexed.plan), /content_plan_(owner_idx|brand_idx|cluster_uidx)/);
    assert.match(JSON.stringify(indexed.snapshot), /report_snapshot_(owner_idx|brand_idx|operation_uidx|predecessor_idx)/);
    console.log(JSON.stringify({
      event: "m0-query-plan",
      kind,
      synthetic: true,
      rows: { observations: 280, tasks: 160, plans: 160, snapshots: 80 },
      statements: 1,
      elapsedMs,
      indexed,
      natural: {
        observation: observationPlan.natural,
        task: taskPlan.natural,
        plan: planPlan.natural,
        snapshot: snapshotPlan.natural,
      },
    }));
  });
}
