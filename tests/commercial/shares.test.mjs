import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { whitelabelReport } from "../../src/features/commercial/billing.ts";
import {
  formatShareSample,
  shareErrors,
  shareRegistrationInput,
} from "../../src/features/commercial/share-contracts.ts";
import {
  loadShareWorkspace,
  registerWhitelabelShare,
  revokeWhitelabelShare,
  sharesOwnedBy,
  viewWhitelabelShare,
} from "../../src/features/commercial/share-commands.ts";
import { shareByIdQuery, sharesForBrandsQuery, sharesForOwnerQuery } from "../../src/features/commercial/share-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T04:00:00.000Z";
const later = "2026-11-23T05:00:00.000Z";
const expiry = "2026-12-31T00:00:00.000Z";
const nameA = "品牌甲分享名称合成";
const nameB = "品牌乙分享名称合成";
const factA = "品牌甲分享事实合成不可泄露";
const secretSample = 86421397;
const guaranteeCopy = "保证提升排名并承诺效果";

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("share input rejects manual fields and effect guarantees and keeps sample size text stable", async () => {
  assert.equal(shareErrors.INVALID_INPUT, 400);
  assert.equal(shareErrors.FORBIDDEN, 403);
  assert.equal(shareErrors.NOT_FOUND, 404);
  const shareId = randomUUID();
  assert.equal(safeReturnTo("/dashboard/reports/shares"), "/dashboard/reports/shares");
  assert.equal(safeReturnTo(`/dashboard/reports/shares/${shareId}`), `/dashboard/reports/shares/${shareId}`);
  const brandId = randomUUID();
  const snapshotId = randomUUID();
  const valid = { brandId, snapshotId, expiresAt: expiry };
  assert.deepEqual(shareRegistrationInput(valid), { input: valid });
  assert.equal(shareRegistrationInput({ ...valid, guarantee: guaranteeCopy }).error, "INVALID_INPUT");
  assert.equal(shareRegistrationInput({ ...valid, effectGuarantee: "guaranteed results" }).error, "INVALID_INPUT");
  assert.equal(shareRegistrationInput({ ...valid, promise: guaranteeCopy }).error, "INVALID_INPUT");
  assert.equal(shareRegistrationInput({ ...valid, track: "model_api", sampleSize: 12, grade: "exploratory" }).error, "INVALID_INPUT");
  assert.equal(shareRegistrationInput({ brandId, expiresAt: expiry }).error, "INVALID_INPUT");
  assert.equal(formatShareSample(12), "12");
  assert.equal(formatShareSample(secretSample), "86421397");
  const report = whitelabelReport({ track: "model_api", sampleSize: 12, grade: "exploratory" });
  assert.equal(report.track, "model_api");
  assert.equal(report.sampleSize, 12);
  assert.equal(report.grade, "exploratory");
  assert.equal(report.guaranteeRemoved, false);
  const zh = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.equal(zh.shares.sampleHint.includes("样本量"), true);
  assert.equal(en.shares.sampleHint.includes("integer"), true);
  assert.equal(zh.shares.statusRevoked, "已撤销");
  assert.equal(en.shares.statusRevoked, "Revoked");
  for (const catalog of [zh.shares, en.shares]) {
    assert.equal(/保证提升排名|guaranteed ranking|guaranteed improvement/i.test(JSON.stringify(catalog)), false);
  }
  const query = sharesForOwnerQuery(brandId);
  assert.deepEqual(query.values, [brandId, 100]);
  assert.equal(query.sql.includes("whitelabel_share"), true);
  assert.equal(query.sql.includes("whitelabel_share_access"), true);
  assert.equal(query.sql.includes("owner_id = ?"), true);
  assert.equal(query.sql.includes("brand_version"), false);
  const brandQuery = sharesForBrandsQuery([brandId]);
  assert.deepEqual(brandQuery.values, [brandId, 100]);
  assert.equal(brandQuery.sql.includes("s.brand_id IN (?)"), true);
  const one = shareByIdQuery(shareId);
  assert.equal(one.sql.includes("WHERE s.id = ?"), true);
});

function hidden(value, forbidden) {
  const text = JSON.stringify(value);
  for (const secret of forbidden) assert.equal(text.includes(String(secret)), false);
  return text;
}

async function addUser(db, id) {
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "分享夹具", `${id}@example.invalid`]);
}

async function addBrand(db, ownerId, id, name) {
  await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
    VALUES (?, ?, 'active', 1, 1, ?)`, [id, ownerId, time]);
  await queryWithParameters(db, `INSERT INTO brand_version (brand_id, version, name, content, created_at)
    VALUES (?, 1, ?, ?, ?)`, [id, name, JSON.stringify({ fact: factA, name }), time]);
}

async function addGrant(db, { id = randomUUID(), userId, brandId, role, active = 1, expiresAt = null }) {
  await queryWithParameters(
    db,
    `INSERT INTO brand_member_grant (id, user_id, brand_id, role, active, expires_at, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [id, userId, brandId, role, active, expiresAt, time],
  );
  return id;
}

async function addSnapshot(db, {
  brandId,
  ownerId,
  track = "model_api",
  grade = "exploratory",
  beforeSamples = 3,
  afterSamples = 3,
  commonQueries = 3,
  frozenQueries = 4,
  limitations = ["小样本探索，不代表稳定趋势", "无核验生效或仅为诊断复跑，经营闭环未完成"],
}) {
  const retestId = randomUUID();
  const snapshotId = randomUUID();
  await queryWithParameters(
    db,
    `INSERT INTO report_retest (
      id, brand_id, owner_id, kind, status, intent, track, timezone, entity_version,
      before_run_id, after_run_id, publication_id, effective_at, operation_id,
      comparison_json, block_reason, created_at, updated_at
    ) VALUES (?, ?, ?, 'diagnostic', 'completed', 'diagnostic', ?, 'Asia/Shanghai', 1, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)`,
    [retestId, brandId, ownerId, track, randomUUID(), time, time],
  );
  const doc = {
    schema_version: "report-v4",
    report_id: snapshotId,
    grade,
    intent: "diagnostic",
    loop_completed: false,
    source_missing: false,
    limitations,
    evidence: {},
    comparisons: {
      mention_rate: {
        common_query_count: commonQueries,
        frozen_query_count: frozenQueries,
        before_sample_count: beforeSamples,
        after_sample_count: afterSamples,
        queries: [],
      },
      recommendation_rate: {
        common_query_count: commonQueries,
        frozen_query_count: frozenQueries,
        before_sample_count: beforeSamples,
        after_sample_count: afterSamples,
        queries: [],
      },
      official_site_citation_rate: {
        common_query_count: commonQueries,
        frozen_query_count: frozenQueries,
        before_sample_count: beforeSamples,
        after_sample_count: afterSamples,
        queries: [],
      },
    },
  };
  const jsonBytes = JSON.stringify(doc);
  const htmlBytes = `<html><body><p>${grade}</p></body></html>`;
  await queryWithParameters(
    db,
    `INSERT INTO report_snapshot (
      id, brand_id, owner_id, retest_id, status, grade, intent, loop_completed, predecessor_id,
      entity_version, timezone, locale, source_missing, json_bytes, html_bytes, json_sha256, html_sha256,
      operation_id, created_at, html_object_id, json_object_id
    ) VALUES (?, ?, ?, ?, 'created', ?, 'diagnostic', 0, NULL, 1, 'Asia/Shanghai', 'zh-CN', 0, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [snapshotId, brandId, ownerId, retestId, grade, jsonBytes, htmlBytes, sha256(jsonBytes), sha256(htmlBytes), randomUUID(), time],
  );
  return { retestId, snapshotId, limitations };
}

async function countOf(db, table) {
  const [row] = await queryWithParameters(db, `SELECT count(*) AS n FROM ${table}`, []);
  return Number(row.n);
}

function watch(db) {
  const sqls = [];
  const calls = [];
  return {
    sqls,
    calls,
    connection: {
      kind: db.kind,
      query(sql, values) {
        sqls.push(sql);
        calls.push(values ?? []);
        return db.query(sql, values);
      },
      transaction(work) {
        return db.transaction(work);
      },
      close() {
        return db.close();
      },
    },
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: snapshot-backed white-label share honors brand authorization, limitations and revoke`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const ownerA = randomUUID();
      const memberA = randomUUID();
      const readOnlyA = randomUUID();
      const ownerB = randomUUID();
      const outsider = randomUUID();
      const brandA = randomUUID();
      const brandB = randomUUID();
      const frozen = randomUUID();
      await addUser(db, ownerA);
      await addUser(db, memberA);
      await addUser(db, readOnlyA);
      await addUser(db, ownerB);
      await addUser(db, outsider);
      await addBrand(db, ownerA, frozen, "冻结品牌分享名称合成");
      await queryWithParameters(db, `UPDATE brand SET frozen_at = ? WHERE id = ?`, [time, frozen]);
      await addBrand(db, ownerA, brandA, nameA);
      await addBrand(db, ownerB, brandB, nameB);
      await addGrant(db, { userId: ownerA, brandId: brandA, role: "owner" });
      await addGrant(db, { userId: memberA, brandId: brandA, role: "member" });
      const readGrantId = await addGrant(db, { userId: readOnlyA, brandId: brandA, role: "read_only" });

      const snapA = await addSnapshot(db, { brandId: brandA, ownerId: ownerA, track: "model_api", grade: "exploratory", beforeSamples: 3, afterSamples: 3 });
      const snapB = await addSnapshot(db, {
        brandId: brandB,
        ownerId: ownerB,
        track: "consumer_ui",
        grade: "incomparable",
        beforeSamples: 2,
        afterSamples: secretSample - 2,
        commonQueries: 2,
        frozenQueries: 3,
      });
      const snapFrozen = await addSnapshot(db, { brandId: frozen, ownerId: ownerA });

      const claim = { brandId: brandA, snapshotId: snapA.snapshotId, expiresAt: expiry };
      assert.equal(shareRegistrationInput({ ...claim, guarantee: guaranteeCopy }).error, "INVALID_INPUT");
      assert.equal(shareRegistrationInput({ ...claim, track: "model_api" }).error, "INVALID_INPUT");
      assert.equal(await countOf(db, "whitelabel_share"), 0);

      // read_only cannot create a share (403 FORBIDDEN); outsider gets 404 NOT_FOUND
      assert.deepEqual(await registerWhitelabelShare(db, readOnlyA, claim, time), { error: "FORBIDDEN" });
      assert.deepEqual(await registerWhitelabelShare(db, outsider, claim, time), { error: "NOT_FOUND" });
      assert.deepEqual(await registerWhitelabelShare(db, ownerA, { brandId: brandA, snapshotId: snapB.snapshotId, expiresAt: expiry }, time), { error: "NOT_FOUND" });
      assert.deepEqual(await registerWhitelabelShare(db, ownerA, { brandId: brandA, snapshotId: snapA.snapshotId, expiresAt: time }, time), { error: "INVALID_INPUT" });
      assert.deepEqual(await registerWhitelabelShare(db, ownerA, { brandId: frozen, snapshotId: snapFrozen.snapshotId, expiresAt: expiry }, time), { error: "NOT_FOUND" });

      const created = await registerWhitelabelShare(db, ownerA, claim, time);
      assert.equal("share" in created, true);
      assert.equal(created.share.snapshotId, snapA.snapshotId);
      assert.equal(created.share.track, "model_api");
      assert.equal(created.share.sampleSize, 6);
      assert.equal(created.share.grade, "exploratory");
      assert.deepEqual(created.share.limitations, snapA.limitations);
      assert.deepEqual(created.share.sampleSummary, {
        beforeSampleCount: 3,
        afterSampleCount: 3,
        commonQueryCount: 3,
        frozenQueryCount: 4,
        evidenceCount: 0,
        intent: "diagnostic",
        loopCompleted: false,
        sourceMissing: false,
      });

      const secret = await registerWhitelabelShare(db, ownerB, {
        brandId: brandB,
        snapshotId: snapB.snapshotId,
        expiresAt: expiry,
      }, time);
      assert.equal(secret.share.sampleSize, secretSample);
      assert.equal(secret.share.track, "consumer_ui");
      assert.equal(await countOf(db, "whitelabel_share"), 2);

      // Member can also create a share for brand A
      const memberCreated = await registerWhitelabelShare(db, memberA, {
        brandId: brandA,
        snapshotId: snapA.snapshotId,
        expiresAt: "2026-11-24T00:00:00.000Z",
      }, time);
      assert.equal("share" in memberCreated, true);
      assert.equal(memberCreated.share.track, "model_api");

      // Authorized read_only viewer sees the exact same track, sampleSize, sampleSummary and limitations
      const roWorkspace = await loadShareWorkspace(db, readOnlyA, later);
      assert.equal(roWorkspace.brands.length, 0);
      assert.equal(roWorkspace.writableBrandIds.length, 0);
      assert.equal(roWorkspace.brandNames[brandA], nameA);
      assert.equal(roWorkspace.shares.length, 2);
      assert.equal(roWorkspace.shares.find((s) => s.id === created.share.id)?.sampleSize, 6);
      assert.deepEqual(roWorkspace.shares.find((s) => s.id === created.share.id)?.limitations, snapA.limitations);
      hidden(roWorkspace, [factA, secretSample, nameB, "consumer_ui"]);

      const roPreview = await viewWhitelabelShare(db, readOnlyA, created.share.id, later);
      assert.equal("share" in roPreview, true);
      assert.equal(roPreview.share.brandName, nameA);
      assert.equal(roPreview.share.snapshotId, snapA.snapshotId);
      assert.equal(roPreview.share.track, "model_api");
      assert.equal(roPreview.share.sampleSize, 6);
      assert.equal(roPreview.share.grade, "exploratory");
      assert.deepEqual(roPreview.share.limitations, snapA.limitations);
      assert.equal(await countOf(db, "whitelabel_share_access"), 1);

      // Outsider and cross-brand owner cannot view or revoke
      const missed = await viewWhitelabelShare(db, ownerA, secret.share.id, later);
      assert.deepEqual(missed, { error: "NOT_FOUND" });
      hidden(missed, [secretSample, "consumer_ui", "incomparable", nameB, factA]);
      assert.deepEqual(await viewWhitelabelShare(db, outsider, created.share.id, later), { error: "NOT_FOUND" });

      // read_only cannot revoke (403 FORBIDDEN); outsider cannot revoke (404 NOT_FOUND)
      assert.deepEqual(await revokeWhitelabelShare(db, readOnlyA, created.share.id, later), { error: "FORBIDDEN" });
      assert.deepEqual(await revokeWhitelabelShare(db, outsider, created.share.id, later), { error: "NOT_FOUND" });
      assert.deepEqual(await revokeWhitelabelShare(db, ownerA, secret.share.id, later), { error: "NOT_FOUND" });

      // If read_only grant is revoked, viewer loses access even while share is active
      await queryWithParameters(db, `UPDATE brand_member_grant SET active = 0 WHERE id = ?`, [readGrantId]);
      assert.deepEqual(await viewWhitelabelShare(db, readOnlyA, created.share.id, later), { error: "NOT_FOUND" });
      await queryWithParameters(db, `UPDATE brand_member_grant SET active = 1 WHERE id = ?`, [readGrantId]);

      // Revoking the share immediately invalidates preview while keeping access history (visitorId = readOnlyA)
      const revoked = await revokeWhitelabelShare(db, ownerA, created.share.id, later);
      assert.deepEqual(revoked, { share: { id: created.share.id, revoked: 1 } });
      assert.deepEqual(await viewWhitelabelShare(db, readOnlyA, created.share.id, later), { error: "NOT_FOUND" });
      assert.deepEqual(await viewWhitelabelShare(db, ownerA, created.share.id, later), { error: "NOT_FOUND" });
      assert.equal(await countOf(db, "whitelabel_share_access"), 1);

      // Expired share cannot be viewed
      assert.deepEqual(await viewWhitelabelShare(db, readOnlyA, memberCreated.share.id, "2026-11-24T00:00:00.000Z"), { error: "NOT_FOUND" });
      assert.equal(await countOf(db, "whitelabel_share_access"), 1);

      const listed = watch(db);
      const own = await sharesOwnedBy(listed.connection, ownerA);
      assert.equal(listed.sqls.length, 1);
      assert.equal(own.length, 2);
      const revokedRow = own.find((row) => row.id === created.share.id);
      assert.equal(revokedRow?.revoked, 1);
      assert.equal(revokedRow?.accesses.length, 1);
      assert.equal(revokedRow?.accesses[0].visitorId, readOnlyA);
      hidden(own, [secretSample, "consumer_ui", factA, nameB]);

      const workspace = await loadShareWorkspace(db, ownerA, later);
      assert.equal(workspace.brands[0].name, nameA);
      assert.equal(workspace.snapshots.some((s) => s.id === snapA.snapshotId), true);
      hidden(workspace, [factA, secretSample, nameB]);

      // DB constraints check
      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO whitelabel_share
          (id, brand_id, owner_id, track, sample_size, grade, expires_at, revoked, created_at)
          VALUES (?, ?, ?, 'model_api', 12, 'exploratory', ?, 2, ?)`, [randomUUID(), brandA, ownerA, expiry, time]),
        /CHECK|check|constraint/i,
      );
      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO whitelabel_share
          (id, brand_id, owner_id, track, sample_size, grade, expires_at, revoked, created_at)
          VALUES (?, ?, ?, 'model_api', -1, 'exploratory', ?, 0, ?)`, [randomUUID(), brandA, ownerA, expiry, time]),
        /CHECK|check|constraint/i,
      );

      for (let index = 0; index < 24; index += 1) {
        await queryWithParameters(db, `INSERT INTO whitelabel_share
          (id, brand_id, owner_id, snapshot_id, track, sample_size, grade, expires_at, revoked, created_at)
          VALUES (?, ?, ?, ?, 'model_api', 6, 'exploratory', ?, 0, ?)`, [randomUUID(), brandA, ownerA, snapA.snapshotId, expiry, time]);
      }
      if (db.kind === "postgresql") await db.query("ANALYZE whitelabel_share");
      const listQuery = sharesForBrandsQuery([brandA]);
      const planFor = async (sql, values) => db.kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
      const plan = await planFor(listQuery.sql, listQuery.values);
      assert.match(plan, /whitelabel_share_brand_idx|whitelabel_share_owner_idx/);
      assert.match(JSON.stringify(await structure(db)), /whitelabel_share_brand_idx/);
      assert.match(JSON.stringify(await structure(db)), /whitelabel_share_snapshot_idx/);
      assert.match(JSON.stringify(await structure(db)), /whitelabel_share_access_share_idx/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
