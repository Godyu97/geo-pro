import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { readObservation, submitManualEvidence } from "../../src/features/evidence/commands.ts";
import { resolveSamplingConditions } from "../../src/features/evidence/contracts.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌", description: "Synthetic sampling-condition fixture", website: "",
  aliases: [], region: "CN", language: "zh-CN", competitors: [], questions: [],
};

// Last migrations before observations recorded target and actual conditions separately.
const beforeSamplingConditions = {
  sqlite: "0064_narrow_zodiak",
  postgresql: "0065_goofy_lorna_dane",
};

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrate(env) {
  execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "Sampling owner", `${id}@example.invalid`]);
  return id;
}

async function brandFor(db, ownerId) {
  const brandId = randomUUID();
  const brands = new BrandDao(db);
  await brands.insertBrand(ownerId, brandId, time);
  await brands.insertVersion(brandId, 1, fields, time);
  return brandId;
}

function manual(brandId, ownerId, overrides = {}) {
  return {
    action: "submit-manual",
    brandId,
    operationId: randomUUID(),
    questionText: "隔离样本：这个品类怎么选？",
    answerText: "隔离样本回答。不代表真实城市排名。",
    region: "CN",
    language: "zh-CN",
    requestedNetworkMode: "unknown",
    entityVersion: 1,
    citationSetState: "complete",
    citations: [],
    locatorRef: "fixture://sampling-conditions",
    collectorId: ownerId,
    contested: false,
    brandName: "乙品牌",
    aliases: [],
    officialWebsite: null,
    ...overrides,
  };
}

function watch(connection) {
  const queries = [];
  const wrap = (current) => ({
    kind: current.kind,
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
    close() {
      return current.close();
    },
  });
  return { connection: wrap(connection), queries };
}

test("sampling condition copy keeps target and unknown observed labels in both locales", () => {
  const zh = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8")).evidence;
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8")).evidence;
  const page = readFileSync("src/features/evidence/detail-page.tsx", "utf8");
  assert.match(zh.targetRegion, /目标/);
  assert.match(zh.observedRegionUnknown, /实际未知/);
  assert.match(en.targetRegion, /Target/);
  assert.match(en.observedRegionUnknown, /unknown/i);
  assert.match(page, /t\("targetRegion"\)/);
  assert.match(page, /t\("observedRegionUnknown"\)/);
  assert.match(page, /t\("newSession"\)/);
  assert.match(page, /t\("productMode"\)/);
  const resolved = resolveSamplingConditions({ region: "CN", observedRegion: "unknown" });
  assert.equal(resolved.observedRegion, "unknown");
  assert.equal(resolved.targetRegion, "CN");
  assert.notEqual(resolved.observedRegion, resolved.targetRegion);
  assert.equal(resolveSamplingConditions({ region: "cn", observedRegion: "us", newSession: "true", productMode: "false" }).observedRegion, "US");
  assert.equal(resolveSamplingConditions({ region: "CN", newSession: "" }), null);
  assert.equal(resolveSamplingConditions({ region: "CN", productMode: "" }), null);
  assert.equal(resolveSamplingConditions({ region: "CN", observedRegion: "" }), null);
  assert.equal(resolveSamplingConditions({ region: "CN", observedRegion: "USA" }), null);
  assert.equal(resolveSamplingConditions({ region: "CN", observedRegion: "C" }), null);
  assert.equal(resolveSamplingConditions({ region: "CN", targetRegion: "US" }), null);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: migrated observations keep the old region as target and unknown actual conditions`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, beforeSamplingConditions[kind]);
    const ownerId = await account(db);
    const brandId = await brandFor(db, ownerId);
    const observationId = randomUUID();
    await queryWithParameters(db, `INSERT INTO answer_observation (
      id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method, question_text, answer_text,
      fingerprint, captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
      evidence_state, locator_ref, collector_id, missing_reason, created_at
    ) VALUES (?, ?, ?, NULL, NULL, 'consumer_ui', 'manual', '旧问题', '旧回答', ?, ?, 'CN', 'zh-CN', 'unknown', 1, 'complete', 'complete', NULL, NULL, NULL, ?)`,
    [observationId, brandId, ownerId, fingerprint(observationId), time, time]);
    migrate(fixture.env);
    const [row] = await queryWithParameters(db, `SELECT region, target_region AS "targetRegion",
      observed_region AS "observedRegion", new_session AS "newSession", product_mode AS "productMode"
      FROM answer_observation WHERE id = ?`, [observationId]);
    assert.equal(row.region, "CN");
    assert.equal(row.targetRegion, "CN");
    assert.equal(row.observedRegion, "unknown");
    assert.equal(row.newSession, "unknown");
    assert.equal(row.productMode, "unknown");
    assert.notEqual(row.observedRegion, row.targetRegion);
  });

  test(`${kind}: new evidence stores unknown actual region separately and hides it from another user`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const ownerId = await account(db);
    const outsiderId = await account(db);
    const brandId = await brandFor(db, ownerId);

    const unknown = await submitManualEvidence(db, ownerId, manual(brandId, ownerId, { observedRegion: "unknown" }), clock);
    assert.equal(unknown.error, undefined);
    assert.equal(unknown.observation.region, "CN");
    assert.equal(unknown.observation.targetRegion, "CN");
    assert.equal(unknown.observation.observedRegion, "unknown");
    assert.equal(unknown.observation.newSession, "unknown");
    assert.equal(unknown.observation.productMode, "unknown");
    assert.notEqual(unknown.observation.observedRegion, unknown.observation.targetRegion);

    const omitted = await submitManualEvidence(db, ownerId, manual(brandId, ownerId), clock);
    assert.equal(omitted.observation.observedRegion, "unknown");
    assert.equal(omitted.observation.newSession, "unknown");
    assert.equal(omitted.observation.productMode, "unknown");

    const explicit = await submitManualEvidence(db, ownerId, manual(brandId, ownerId, {
      observedRegion: "us",
      newSession: "true",
      productMode: "false",
    }), clock);
    assert.equal(explicit.observation.targetRegion, "CN");
    assert.equal(explicit.observation.observedRegion, "US");
    assert.equal(explicit.observation.newSession, "true");
    assert.equal(explicit.observation.productMode, "false");

    for (const overrides of [
      { observedRegion: "" },
      { observedRegion: "USA" },
      { newSession: "" },
      { productMode: "" },
      { targetRegion: "US" },
    ]) {
      const rejected = await submitManualEvidence(db, ownerId, manual(brandId, ownerId, overrides), clock);
      assert.equal(rejected.error, "INVALID_INPUT");
      assert.equal(rejected.observation, undefined);
    }

    const watched = watch(db);
    const started = performance.now();
    const visible = await readObservation(watched.connection, ownerId, unknown.observation.id);
    const hidden = await readObservation(watched.connection, outsiderId, unknown.observation.id);
    const elapsed = performance.now() - started;
    assert.equal(visible.observation.observedRegion, "unknown");
    assert.equal(hidden, null);
    assert.equal(watched.queries.length, 8);
    assert.equal(watched.queries.filter((sql) => sql.includes("target_region")).length, 1);
    console.log(`${kind} sampling-condition read ${watched.queries.length} sql ${elapsed.toFixed(2)} ms`);

    const defaultedId = randomUUID();
    await queryWithParameters(db, `INSERT INTO answer_observation (
      id, brand_id, owner_id, source_mode, capture_method, question_text, answer_text, fingerprint,
      captured_at, region, language, requested_network_mode, entity_version, citation_set_state,
      evidence_state, created_at, target_region
    ) VALUES (?, ?, ?, 'consumer_ui', 'manual', '缺省条件', '隔离回答', ?, ?, 'CN', 'zh-CN', 'off', 1, 'complete', 'complete', ?, 'CN')`,
    [defaultedId, brandId, ownerId, fingerprint(defaultedId), time, time]);
    const [defaulted] = await queryWithParameters(db, `SELECT observed_region AS "observedRegion",
      new_session AS "newSession", product_mode AS "productMode" FROM answer_observation WHERE id = ?`, [defaultedId]);
    assert.equal(defaulted.observedRegion, "unknown");
    assert.equal(defaulted.newSession, "unknown");
    assert.equal(defaulted.productMode, "unknown");

    await assert.rejects(() => queryWithParameters(db, `UPDATE answer_observation SET product_mode = '' WHERE id = ?`, [unknown.observation.id]));
    await assert.rejects(() => queryWithParameters(db, `UPDATE answer_observation SET new_session = 'yes' WHERE id = ?`, [unknown.observation.id]));
    await assert.rejects(() => queryWithParameters(db, `UPDATE answer_observation SET observed_region = 'C' WHERE id = ?`, [unknown.observation.id]));
  });
}
