import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
import { shareForOwnerQuery, sharesForOwnerQuery } from "../../src/features/commercial/share-dao.ts";
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

test("share input rejects an effect guarantee and keeps the sample size text stable", async () => {
  assert.equal(shareErrors.INVALID_INPUT, 400);
  assert.equal(shareErrors.NOT_FOUND, 404);
  assert.equal(safeReturnTo("/dashboard/reports/shares"), "/dashboard/reports/shares");
  const brandId = randomUUID();
  const valid = { brandId, track: "official_api", sampleSize: 12, grade: "exploratory", expiresAt: expiry };
  assert.deepEqual(shareRegistrationInput(valid), { input: valid });
  assert.equal(shareRegistrationInput({ ...valid, guarantee: guaranteeCopy }).error, "INVALID_INPUT");
  assert.equal(shareRegistrationInput({ ...valid, effectGuarantee: "guaranteed results" }).error, "INVALID_INPUT");
  assert.equal(shareRegistrationInput({ ...valid, promise: guaranteeCopy }).error, "INVALID_INPUT");
  assert.equal(shareRegistrationInput({ ...valid, track: "保证提升" }).error, "INVALID_INPUT");
  assert.equal(shareRegistrationInput({ ...valid, sampleSize: -1 }).error, "INVALID_INPUT");
  assert.equal(shareRegistrationInput({ ...valid, grade: "Exploratory" }).error, "INVALID_INPUT");
  assert.equal(formatShareSample(12), "12");
  assert.equal(formatShareSample(secretSample), "86421397");
  const report = whitelabelReport({ track: valid.track, sampleSize: valid.sampleSize, grade: valid.grade });
  assert.equal(report.track, "official_api");
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
  const one = shareForOwnerQuery(brandId, brandId);
  assert.equal(one.sql.includes("id = ? AND owner_id = ?"), true);
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
    },
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: a white-label share keeps sample limits and access history after revoke`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const ownerA = randomUUID();
      const ownerB = randomUUID();
      const brandA = randomUUID();
      const brandB = randomUUID();
      const frozen = randomUUID();
      await addUser(db, ownerA);
      await addUser(db, ownerB);
      await addBrand(db, ownerA, frozen, "冻结品牌分享名称合成");
      await queryWithParameters(db, `UPDATE brand SET frozen_at = ? WHERE id = ?`, [time, frozen]);
      await addBrand(db, ownerA, brandA, nameA);
      await addBrand(db, ownerB, brandB, nameB);

      const claim = { brandId: brandA, track: "official_api", sampleSize: 12, grade: "exploratory", expiresAt: expiry };
      assert.equal(shareRegistrationInput({ ...claim, guarantee: guaranteeCopy }).error, "INVALID_INPUT");
      assert.equal(shareRegistrationInput({ ...claim, effect: "guaranteed results" }).error, "INVALID_INPUT");
      assert.equal(await countOf(db, "whitelabel_share"), 0);

      const watched = watch(db);
      const created = await registerWhitelabelShare(watched.connection, ownerA, claim, time);
      const report = whitelabelReport({ track: "official_api", sampleSize: 12, grade: "exploratory" });
      assert.equal(watched.sqls.length, 1);
      assert.match(watched.sqls[0], /,\s*0\s*,/);
      assert.equal(watched.sqls[0].includes("guarantee"), false);
      assert.equal(watched.calls[0].includes(0), false);
      assert.equal(watched.calls[0].includes(report.track), true);
      assert.equal(watched.calls[0].includes(report.sampleSize), true);
      assert.equal(watched.calls[0].includes(report.grade), true);
      assert.equal(created.share.track, report.track);
      assert.equal(created.share.sampleSize, report.sampleSize);
      assert.equal(created.share.grade, report.grade);
      assert.equal(formatShareSample(created.share.sampleSize), "12");
      const [stored] = await queryWithParameters(db, `SELECT track, sample_size AS "sampleSize", grade, revoked FROM whitelabel_share WHERE id = ?`, [created.share.id]);
      assert.equal(stored.track, "official_api");
      assert.equal(Number(stored.sampleSize), 12);
      assert.equal(stored.grade, "exploratory");
      assert.equal(Number(stored.revoked), 0);

      const expired = await registerWhitelabelShare(db, ownerA, { ...claim, expiresAt: time }, time);
      assert.equal(expired.error, "INVALID_INPUT");
      const foreignBrand = await registerWhitelabelShare(db, ownerA, { ...claim, brandId: brandB, sampleSize: secretSample }, time);
      assert.equal(foreignBrand.error, "NOT_FOUND");
      const frozenBrand = await registerWhitelabelShare(db, ownerA, { ...claim, brandId: frozen }, time);
      assert.equal(frozenBrand.error, "NOT_FOUND");
      const secret = await registerWhitelabelShare(db, ownerB, {
        brandId: brandB, track: "consumer_manual", sampleSize: secretSample, grade: "incomparable", expiresAt: expiry,
      }, time);
      assert.equal(secret.share.sampleSize, secretSample);
      assert.equal(await countOf(db, "whitelabel_share"), 2);

      const missed = await viewWhitelabelShare(db, ownerA, secret.share.id, later);
      assert.deepEqual(missed, { error: "NOT_FOUND" });
      hidden(missed, [secretSample, "consumer_manual", "incomparable", nameB, factA]);
      const seen = await viewWhitelabelShare(db, ownerA, created.share.id, later);
      assert.equal(seen.share.track, "official_api");
      assert.equal(seen.share.sampleSize, 12);
      assert.equal(seen.share.grade, "exploratory");
      assert.equal(formatShareSample(seen.share.sampleSize), "12");
      assert.equal(await countOf(db, "whitelabel_share_access"), 1);

      const revoked = await revokeWhitelabelShare(db, ownerA, created.share.id);
      assert.equal(revoked.share.revoked, 1);
      hidden(revoked, [secretSample, factA]);
      const after = await viewWhitelabelShare(db, ownerA, created.share.id, later);
      assert.deepEqual(after, { error: "NOT_FOUND" });
      hidden(after, [secretSample, "official_api", factA]);
      assert.equal(await countOf(db, "whitelabel_share_access"), 1);
      const otherRevoke = await revokeWhitelabelShare(db, ownerA, secret.share.id);
      assert.deepEqual(otherRevoke, { error: "NOT_FOUND" });
      hidden(otherRevoke, [secretSample]);

      const listed = watch(db);
      const own = await sharesOwnedBy(listed.connection, ownerA);
      assert.equal(listed.sqls.length, 1);
      assert.equal(listed.sqls[0].includes("DELETE"), false);
      assert.equal(own.length, 1);
      assert.equal(own[0].revoked, 1);
      assert.equal(own[0].accesses.length, 1);
      assert.equal(own[0].accesses[0].visitorId, ownerA);
      assert.equal(own[0].sampleSize, 12);
      hidden(own, [secretSample, "consumer_manual", factA, nameB]);
      const other = await sharesOwnedBy(db, ownerB);
      assert.equal(other.length, 1);
      assert.equal(other[0].sampleSize, secretSample);
      assert.equal(other[0].track, "consumer_manual");
      assert.equal(other[0].accesses.length, 0);
      assert.equal(other.some((share) => share.sampleSize === 12 || share.track === "official_api"), false);
      hidden(other, [nameA, factA]);

      const expiredView = await registerWhitelabelShare(db, ownerA, { ...claim, expiresAt: "2026-11-24T00:00:00.000Z" }, time);
      const tooLate = await viewWhitelabelShare(db, ownerA, expiredView.share.id, "2026-11-24T00:00:00.000Z");
      assert.deepEqual(tooLate, { error: "NOT_FOUND" });
      assert.equal(await countOf(db, "whitelabel_share_access"), 1);

      const workspaceWatch = watch(db);
      const workspace = await loadShareWorkspace(workspaceWatch.connection, ownerA);
      assert.equal(workspaceWatch.sqls.length, 2);
      assert.equal(workspaceWatch.sqls.filter((sql) => sql.includes("whitelabel_share")).length, 1);
      assert.equal(workspace.brands[0].name, nameA);
      hidden(workspace, [factA, secretSample, nameB]);

      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO whitelabel_share
          (id, brand_id, owner_id, track, sample_size, grade, expires_at, revoked, created_at)
          VALUES (?, ?, ?, 'official_api', 12, 'exploratory', ?, 2, ?)`, [randomUUID(), brandA, ownerA, expiry, time]),
        /CHECK|check|constraint/i,
      );
      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO whitelabel_share
          (id, brand_id, owner_id, track, sample_size, grade, expires_at, revoked, created_at)
          VALUES (?, ?, ?, 'official_api', -1, 'exploratory', ?, 0, ?)`, [randomUUID(), brandA, ownerA, expiry, time]),
        /CHECK|check|constraint/i,
      );
      const [revokedRows] = await queryWithParameters(db, `SELECT count(*) AS n FROM whitelabel_share_access`, []);
      assert.equal(Number(revokedRows.n), 1);

      for (let index = 0; index < 24; index += 1) {
        await queryWithParameters(db, `INSERT INTO whitelabel_share
          (id, brand_id, owner_id, track, sample_size, grade, expires_at, revoked, created_at)
          VALUES (?, ?, ?, 'official_api', 12, 'exploratory', ?, 0, ?)`, [randomUUID(), brandA, ownerA, expiry, time]);
      }
      const scale = watch(db);
      const scaled = await sharesOwnedBy(scale.connection, ownerA);
      assert.equal(scale.sqls.length, 1);
      assert.equal(scaled.length, 26);
      hidden(scaled, [secretSample, "consumer_manual"]);
      if (db.kind === "postgresql") await db.query("ANALYZE whitelabel_share");
      const listQuery = sharesForOwnerQuery(ownerA);
      const planFor = async (sql, values) => db.kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
      const plan = await planFor(listQuery.sql, listQuery.values);
      assert.match(plan, /whitelabel_share_owner_idx/);
      assert.match(JSON.stringify(await structure(db)), /whitelabel_share_owner_idx/);
      assert.match(JSON.stringify(await structure(db)), /whitelabel_share_access_share_idx/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
