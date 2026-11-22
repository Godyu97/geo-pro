import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { decideApproval, listApprovalPolicies, saveApprovalPolicy } from "../../src/features/approval-policy/commands.ts";
import { saveApprovalPolicySchema } from "../../src/features/approval-policy/contracts.ts";
import { attemptsByVersionQuery, dutyByActorQuery, policyByBrandQuery } from "../../src/features/approval-policy/dao.ts";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T12:00:00.000Z";
const factClock = () => new Date(time);
const brandName = "品牌私密名称合成";
const secretTitle = "版本标题机密合成";
const secretBody = "版本正文机密合成不可外泄";
const secretClaim = "事实主张机密合成不可外泄";
const brandFields = {
  name: brandName,
  description: "Synthetic brand for approval policy",
  website: "https://ding.example.com",
  aliases: ["丁"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};
const usableFact = {
  ...emptyFields,
  category: "price",
  title: "Synthetic plan price",
  claim: secretClaim,
  sourceType: "url",
  sourceReference: "https://ding.example.com/pricing",
  sourceLocator: "Section 1",
  sourceExcerpt: "Public price excerpt",
  sourceDate: "2026-11-18",
  permission: "public",
  validity: "dated",
  validThrough: "2026-12-31",
};

function secrets(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(brandName), false);
  assert.equal(text.includes(secretTitle), false);
  assert.equal(text.includes(secretBody), false);
  assert.equal(text.includes(secretClaim), false);
  return text;
}

async function addUser(db, id) {
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "审核夹具", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
}

async function addBrand(db, ownerId, id) {
  const brands = new BrandDao(db);
  await brands.insertBrand(ownerId, id, time);
  await brands.insertVersion(id, 1, brandFields, time);
}

async function approveFact(db, ownerId, brandId, fields) {
  const id = randomUUID();
  const run = (command) => executeFactCommand(db, { ownerId, brandId }, command, factClock);
  assert.deepEqual(await run({ action: "create", id, previousId: null, fields }), { id });
  assert.deepEqual(await run({ action: "submit", id, revision: 1 }), { id });
  assert.deepEqual(await run({
    action: "approve", id, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
  }), { id });
  return id;
}

async function pendingFact(db, ownerId, brandId) {
  const id = randomUUID();
  const run = (command) => executeFactCommand(db, { ownerId, brandId }, command, factClock);
  assert.deepEqual(await run({ action: "create", id, previousId: null, fields: usableFact }), { id });
  assert.deepEqual(await run({ action: "submit", id, revision: 1 }), { id });
  return id;
}

async function seedVersion(db, brand, ownerId, factId, authorId = ownerId) {
  const [briefId, briefVersionId, batchId, unitId, versionId] = Array.from({ length: 5 }, () => randomUUID());
  const facts = JSON.stringify([factId]);
  const run = (sql, values) => queryWithParameters(db, sql, values);
  await run("INSERT INTO content_brief (id, brand_id, owner_id, status, created_at, updated_at) VALUES (?, ?, ?, 'confirmed', ?, ?)",
    [briefId, brand, ownerId, time, time]);
  await run(`INSERT INTO content_brief_version (id, brief_id, brand_id, revision, audience, target_gap,
      applicable_boundary, primary_page, conversion_action, template_kind, title_candidates_json,
      fact_version_ids_json, created_at) VALUES (?, ?, ?, 1, 'a', 'g', 'b', 'p', 'c', 'fact_faq', '["t"]', ?, ?)`,
  [briefVersionId, briefId, brand, facts, time]);
  await run(`INSERT INTO content_batch (id, brand_id, owner_id, status, operation_id, cost_ledger_json, created_at, updated_at)
      VALUES (?, ?, ?, 'completed', ?, '{}', ?, ?)`, [batchId, brand, ownerId, randomUUID(), time, time]);
  await run(`INSERT INTO content_batch_unit (id, batch_id, brief_id, brand_id, status, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'succeeded', 1, ?, ?)`, [unitId, batchId, briefId, brand, time, time]);
  await run(`INSERT INTO content_version (id, brand_id, owner_id, brief_id, brief_version_id, batch_unit_id,
      template_kind, title, body_markdown, claims_json, status, fingerprint, created_at, updated_at,
      target_channel, labeling_profile_version, labeling_profile_status, image_asset_ids_json, fact_version_ids_json)
      VALUES (?, ?, ?, ?, ?, ?, 'fact_faq', ?, ?, '{}', 'in_review', 'fp', ?, ?, 'primary_page', 'unverified', 'unverified', '[]', ?)`,
  [versionId, brand, authorId, briefId, briefVersionId, unitId, secretTitle, secretBody, time, time, facts]);
  return versionId;
}

async function approvalRows(db, versionId) {
  return queryWithParameters(db, `SELECT content_fingerprint AS "contentFingerprint", decision,
      actor_id AS "actorId", created_at AS "createdAt", fact_version_ids_json AS "factVersionIdsJson"
    FROM content_approval WHERE content_version_id = ? ORDER BY created_at, id`, [versionId]);
}

async function factRow(db, brandId, factId) {
  const [row] = await queryWithParameters(db, `SELECT state, content, confirmed_by AS "confirmedBy"
    FROM brand_fact_version WHERE brand_id = ? AND id = ?`, [brandId, factId]);
  return row;
}

test("approval policy input rejects an empty duty and unknown fields", () => {
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const userId = randomUUID();
  assert.equal(saveApprovalPolicySchema.safeParse({
    brandId, dualControl: true, duties: [{ userId, factApprover: false, contentApprover: false }],
  }).success, false);
  assert.equal(saveApprovalPolicySchema.safeParse({
    brandId, dualControl: true, duties: [{ userId, factApprover: false, contentApprover: true }], name: brandName,
  }).success, false);
  assert.equal(saveApprovalPolicySchema.safeParse({
    brandId, dualControl: false, duties: [{ userId, factApprover: true, contentApprover: false }],
  }).success, true);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: dual approval keeps historical decisions and rejects the author`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const owner = randomUUID();
      const reviewer = randomUUID();
      const factUser = randomUUID();
      const author = randomUUID();
      const stranger = randomUUID();
      const brand = randomUUID();
      await addUser(db, owner);
      await addUser(db, reviewer);
      await addUser(db, factUser);
      await addUser(db, author);
      await addUser(db, stranger);
      await addBrand(db, owner, brand);
      const factId = await approveFact(db, owner, brand, usableFact);
      const historicalId = await seedVersion(db, brand, owner, factId);

      const first = await decideApproval(db, owner, { brandId: brand, versionId: historicalId, kind: "content" }, time);
      assert.equal(first.status, "approved");
      assert.equal(first.replayed, false);
      secrets(first);
      const before = await approvalRows(db, historicalId);
      assert.equal(before.length, 1);
      assert.equal(before[0].decision, "approved");
      assert.equal(before[0].actorId, owner);

      const outsider = await saveApprovalPolicy(db, reviewer, {
        brandId: brand, dualControl: true, duties: [{ userId: reviewer, factApprover: false, contentApprover: true }],
      }, time);
      assert.equal(outsider.error, "NOT_FOUND");
      const missingUser = await saveApprovalPolicy(db, owner, {
        brandId: brand, dualControl: true, duties: [{ userId: randomUUID(), factApprover: true, contentApprover: false }],
      }, time);
      assert.equal(missingUser.error, "NOT_FOUND");
      assert.equal(Number((await queryWithParameters(db, "SELECT count(*) AS n FROM approval_policy", []))[0].n), 0);
      assert.deepEqual(await approvalRows(db, historicalId), before);

      const saved = await saveApprovalPolicy(db, owner, {
        brandId: brand,
        dualControl: true,
        duties: [
          { userId: reviewer, factApprover: false, contentApprover: true },
          { userId: factUser, factApprover: true, contentApprover: false },
          { userId: author, factApprover: false, contentApprover: true },
        ],
      }, time);
      assert.equal(saved.version, 1);
      assert.equal(saved.dualControl, true);
      secrets(saved);
      assert.deepEqual(await approvalRows(db, historicalId), before);
      const listed = await listApprovalPolicies(db, owner);
      assert.equal(listed.policies[0].version, 1);
      assert.equal(listed.policies[0].dualControl, true);
      secrets(listed);

      const openId = await seedVersion(db, brand, owner, factId);
      const self = await decideApproval(db, owner, { brandId: brand, versionId: openId, kind: "content" }, time);
      assert.equal(self.error, "SEPARATION");
      assert.equal(self.reason, "separation");
      secrets(self);
      assert.equal((await approvalRows(db, openId)).length, 0);
      assert.deepEqual(await approvalRows(db, historicalId), before);
      const wrongDuty = await decideApproval(db, factUser, { brandId: brand, versionId: openId, kind: "content" }, time);
      assert.equal(wrongDuty.error, "DUTY");
      assert.equal(wrongDuty.reason, "duty");
      secrets(wrongDuty);
      assert.equal((await approvalRows(db, openId)).length, 0);
      const reviewed = await decideApproval(db, reviewer, { brandId: brand, versionId: openId, kind: "content" }, time);
      assert.equal(reviewed.status, "approved");
      assert.equal(reviewed.approvalId !== first.approvalId, true);
      secrets(reviewed);
      const reviewedRow = await approvalRows(db, openId);
      assert.equal(reviewedRow.length, 1);
      assert.equal(reviewedRow[0].decision, "approved");
      assert.equal(reviewedRow[0].actorId, reviewer);
      assert.deepEqual(await approvalRows(db, historicalId), before);
      const hidden = await decideApproval(db, stranger, { brandId: brand, versionId: openId, kind: "content" }, time);
      assert.deepEqual(hidden, { error: "NOT_FOUND" });
      secrets(hidden);

      const attempts = await queryWithParameters(db, `SELECT version_id AS "versionId", reason
        FROM approval_attempt WHERE brand_id = ? ORDER BY created_at, id`, [brand]);
      assert.deepEqual(attempts.map((row) => row.reason).sort(), ["duty", "separation"]);
      secrets(attempts);

      const pendingId = await pendingFact(db, owner, brand);
      const pendingBefore = await factRow(db, brand, pendingId);
      assert.equal(pendingBefore.state, "pending_confirmation");
      const contentOnly = await decideApproval(db, reviewer, { brandId: brand, versionId: pendingId, kind: "fact" }, time);
      assert.equal(contentOnly.error, "DUTY");
      secrets(contentOnly);
      assert.equal((await factRow(db, brand, pendingId)).content, pendingBefore.content);
      assert.equal((await factRow(db, brand, pendingId)).state, "pending_confirmation");
      const ownerFact = await decideApproval(db, owner, { brandId: brand, versionId: pendingId, kind: "fact" }, time);
      assert.equal(ownerFact.error, "SEPARATION");
      secrets(ownerFact);
      assert.equal((await factRow(db, brand, pendingId)).content, pendingBefore.content);
      const factApproved = await decideApproval(db, factUser, { brandId: brand, versionId: pendingId, kind: "fact" }, time);
      assert.equal(factApproved.status, "approved");
      assert.equal(factApproved.replayed, false);
      secrets(factApproved);
      const pendingAfter = await factRow(db, brand, pendingId);
      assert.equal(pendingAfter.content, pendingBefore.content);
      assert.equal(pendingAfter.state, "approved");
      assert.equal(pendingAfter.confirmedBy, factUser);
      assert.deepEqual(await approvalRows(db, historicalId), before);

      const authoredId = await seedVersion(db, brand, owner, factId, author);
      const authorSelf = await decideApproval(db, author, { brandId: brand, versionId: authoredId, kind: "content" }, time);
      assert.equal(authorSelf.reason, "separation");
      secrets(authorSelf);
      assert.equal((await approvalRows(db, authoredId)).length, 0);
      const ownerReviewsAuthor = await decideApproval(db, owner, { brandId: brand, versionId: authoredId, kind: "content" }, time);
      assert.equal(ownerReviewsAuthor.status, "approved");
      secrets(ownerReviewsAuthor);
      assert.equal((await approvalRows(db, authoredId))[0].actorId, owner);
      assert.deepEqual(await approvalRows(db, historicalId), before);

      const closed = await saveApprovalPolicy(db, owner, {
        brandId: brand,
        dualControl: false,
        duties: [{ userId: reviewer, factApprover: false, contentApprover: true }],
      }, time);
      assert.equal(closed.version, 2);
      assert.equal(closed.dualControl, false);
      assert.deepEqual(await approvalRows(db, historicalId), before);
      const laterId = await seedVersion(db, brand, owner, factId);
      const single = await decideApproval(db, owner, { brandId: brand, versionId: laterId, kind: "content" }, time);
      assert.equal(single.status, "approved");
      assert.equal(single.replayed, false);
      secrets(single);
      assert.equal((await approvalRows(db, laterId))[0].actorId, owner);
      assert.deepEqual(await approvalRows(db, historicalId), before);
      const ignoredDuty = await decideApproval(db, reviewer, { brandId: brand, versionId: laterId, kind: "content" }, time);
      assert.deepEqual(ignoredDuty, { error: "NOT_FOUND" });

      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO approval_attempt
          (id, brand_id, version_id, kind, reason, actor_id, created_at)
          VALUES (?, ?, ?, 'content', 'role', ?, ?)`, [randomUUID(), brand, randomUUID(), owner, time]),
        /CHECK|check|constraint/i,
      );

      for (let index = 0; index < 24; index += 1) {
        const extraOwner = randomUUID();
        const extraBrand = randomUUID();
        const extraUser = randomUUID();
        await addUser(db, extraOwner);
        await addUser(db, extraUser);
        await addBrand(db, extraOwner, extraBrand);
        await queryWithParameters(db, `INSERT INTO approval_policy
          (id, brand_id, version, dual_control, updated_at, updated_by) VALUES (?, ?, 1, 1, ?, ?)`,
        [randomUUID(), extraBrand, time, owner]);
        await queryWithParameters(db, `INSERT INTO brand_approval_duty
          (id, brand_id, user_id, fact_approver, content_approver, updated_at) VALUES (?, ?, ?, 1, 0, ?)`,
        [randomUUID(), extraBrand, extraUser, time]);
        await queryWithParameters(db, `INSERT INTO approval_attempt
          (id, brand_id, version_id, kind, reason, actor_id, created_at) VALUES (?, ?, ?, 'content', 'duty', ?, ?)`,
        [randomUUID(), brand, historicalId, extraUser, time]);
      }
      if (db.kind === "postgresql") {
        await db.query("ANALYZE approval_policy");
        await db.query("ANALYZE brand_approval_duty");
        await db.query("ANALYZE approval_attempt");
      }
      const planFor = async (sql, values) => db.kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
      const policyQuery = policyByBrandQuery(brand);
      const dutyQuery = dutyByActorQuery(brand, reviewer);
      const attemptQuery = attemptsByVersionQuery(brand, historicalId);
      const policyPlan = await planFor(policyQuery.sql, policyQuery.values);
      const dutyPlan = await planFor(dutyQuery.sql, dutyQuery.values);
      const attemptPlan = await planFor(attemptQuery.sql, attemptQuery.values);
      assert.match(policyPlan, /approval_policy_brand_uidx/);
      assert.match(dutyPlan, /brand_approval_duty_pair_uidx|brand_approval_duty_user_idx/);
      assert.match(attemptPlan, /approval_attempt_version_idx/);
      if (db.kind === "postgresql") {
        assert.doesNotMatch(policyPlan, /Seq Scan on approval_policy/);
        assert.doesNotMatch(dutyPlan, /Seq Scan on brand_approval_duty/);
        assert.doesNotMatch(attemptPlan, /Seq Scan on approval_attempt/);
      }
      const defined = JSON.stringify(await structure(db));
      assert.match(defined, /approval_policy_brand_uidx/);
      assert.match(defined, /brand_approval_duty_pair_uidx/);
      assert.match(defined, /brand_approval_duty_user_idx/);
      assert.match(defined, /approval_attempt_version_idx/);
      assert.deepEqual(await approvalRows(db, historicalId), before);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
