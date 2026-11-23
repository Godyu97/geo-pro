import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { executeBrandCommand } from "../../src/features/brands/commands.ts";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { publishRetentionPolicy } from "../../src/features/brands/retention.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const clock = () => new Date(time);
const fields = { ...initialBrandFields, name: "合成保留品牌", description: "用于保留策略验收的合成业务" };
const firstPolicy = {
  summaryZh: "合成保留策略：默认 30 天可恢复。本记录不删除事实、内容或报告。",
  summaryEn: "Synthetic retention policy: recoverable for 30 days by default. This record does not delete facts, content, or reports.",
  recoverableDays: 30,
};
const secondPolicy = {
  summaryZh: "合成保留策略第二版：仍默认 30 天可恢复。本记录不删除事实、内容或报告。",
  summaryEn: "Synthetic retention policy version 2: still recoverable for 30 days by default. This record does not delete facts, content, or reports.",
  recoverableDays: 30,
};

function createCommand(actorId, acceptedPolicyVersion) {
  return {
    action: "submit", target: null, expectedDraft: null, actorId, operationId: randomUUID(), fields,
    ...(acceptedPolicyVersion === undefined ? {} : { acceptedPolicyVersion }),
  };
}

async function brandCount(db, ownerId) {
  const [row] = await queryWithParameters(db, "SELECT count(*) AS n FROM brand WHERE owner_id = ?", [ownerId]);
  return Number(row.n);
}

function plain(rows) {
  return rows.map((row) => ({ ...row }));
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: brand creation records the accepted retention version and leaves it unchanged`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    const previousDisclosure = process.env.GEO_PILOT_RETENTION_DISCLOSED;
    process.env.GEO_PILOT_RETENTION_DISCLOSED = "true";
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const owner = randomUUID();
      const other = randomUUID();
      for (const id of [owner, other]) {
        await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "Synthetic retention owner", `${id}@example.invalid`]);
      }
      const legacyOwner = randomUUID();
      await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [legacyOwner, "Synthetic legacy owner", `${legacyOwner}@example.invalid`]);
      const dao = new BrandDao(db);
      const run = (actorId, command) => executeBrandCommand(db, actorId, command, undefined, clock);

      assert.deepEqual(await publishRetentionPolicy(db, { ...firstPolicy, summaryZh: " " }, clock), { error: "INVALID_INPUT" });
      assert.deepEqual(await run(owner, createCommand(owner)), { error: "RETENTION_UNPUBLISHED" });
      assert.equal(await brandCount(db, owner), 0);
      assert.equal(await dao.currentRetentionPolicy(), null);

      const published = await publishRetentionPolicy(db, firstPolicy, clock);
      assert.equal(published.policy.version, 1);
      assert.deepEqual(await run(owner, createCommand(owner, 2)), { error: "RETENTION_NOT_ACCEPTED" });
      assert.equal(await brandCount(db, owner), 0);

      const accepted = createCommand(owner, 1);
      const created = await run(owner, accepted);
      assert.equal(created.mutation.kind, "brand");
      assert.deepEqual(await run(owner, accepted), created);
      assert.deepEqual(await run(owner, createCommand(owner, 1)), { error: "LIMIT_REACHED" });
      assert.deepEqual(plain(await queryWithParameters(db, `SELECT policy_version AS "policyVersion", accepted_at AS "acceptedAt"
        FROM brand_retention_acceptance WHERE brand_id = ?`, [created.mutation.id])), [{ policyVersion: 1, acceptedAt: time }]);

      const legacyId = randomUUID();
      await dao.insertBrand(legacyOwner, legacyId, time);
      await dao.insertVersion(legacyId, 1, fields, time);
      const legacy = await dao.retentionView(legacyOwner, legacyId);
      assert.equal(legacy.acceptedVersion, null);
      assert.equal(legacy.currentVersion, 1);
      assert.equal(legacy.currentSummaryZh, firstPolicy.summaryZh);
      assert.deepEqual(plain(await queryWithParameters(db, "SELECT brand_id FROM brand_retention_acceptance WHERE brand_id = ?", [legacyId])), []);

      const second = await publishRetentionPolicy(db, secondPolicy, () => new Date("2026-11-23T09:00:00.000Z"));
      assert.equal(second.policy.version, 2);
      assert.deepEqual(plain(await queryWithParameters(db, `SELECT version, summary_zh AS "summaryZh" FROM retention_policy ORDER BY version`)), [
        { version: 1, summaryZh: firstPolicy.summaryZh },
        { version: 2, summaryZh: secondPolicy.summaryZh },
      ]);
      assert.deepEqual(plain(await queryWithParameters(db, "SELECT policy_version AS version FROM brand_retention_acceptance WHERE brand_id = ?", [created.mutation.id])), [{ version: 1 }]);

      let captured;
      const observed = new BrandDao({ kind: db.kind, query(sql, values) { captured = { sql, values }; return db.query(sql, values); } });
      const view = await observed.retentionView(owner, created.mutation.id);
      const read = captured;
      assert.equal(view.acceptedVersion, 1);
      assert.equal(view.acceptedSummaryEn, firstPolicy.summaryEn);
      assert.equal(view.currentVersion, 2);
      assert.equal(view.currentSummaryZh, secondPolicy.summaryZh);
      assert.equal(view.currentSummaryEn, secondPolicy.summaryEn);
      assert.equal((await dao.retentionView(legacyOwner, legacyId)).acceptedVersion, null);
      assert.equal((await dao.retentionView(legacyOwner, legacyId)).currentVersion, 2);
      assert.equal(await observed.retentionView(other, created.mutation.id), null);
      assert.equal(await dao.version(other, created.mutation.id), null);
      const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
      const plan = JSON.stringify(await db.query(explain + read.sql, read.values));
      assert.match(plan, /retention_policy_pkey|sqlite_autoindex_retention_policy_1|brand_retention_acceptance/);
      console.log(`${kind} retention read plan ${plan}`);
    } finally {
      if (previousDisclosure === undefined) delete process.env.GEO_PILOT_RETENTION_DISCLOSED;
      else process.env.GEO_PILOT_RETENTION_DISCLOSED = previousDisclosure;
      await ddl.cleanup();
      await fixture.cleanup();
    }
  });
}
