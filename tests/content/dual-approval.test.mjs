import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { saveApprovalPolicy } from "../../src/features/approval-policy/commands.ts";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { approveContent, readContentVersion, readPublication, submitManualEvidence } from "../../src/features/content/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T12:00:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);
const claim = "Synthetic claim text";
const usableFact = {
  ...emptyFields,
  category: "price",
  title: "Synthetic plan price",
  claim: "事实主张机密合成不可外泄",
  sourceType: "url",
  sourceReference: "https://ding.example.com/pricing",
  sourceLocator: "Section 1",
  sourceExcerpt: "Public price excerpt",
  sourceDate: "2026-11-18",
  permission: "public",
  validity: "dated",
  validThrough: "2026-12-31",
};

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
  await brands.insertVersion(id, 1, {
    name: "品牌私密名称合成",
    description: "Synthetic brand",
    website: "https://ding.example.com",
    aliases: ["丁"],
    region: "CN",
    language: "zh-CN",
    competitors: [],
    questions: [],
  }, time);
}

async function approveFact(db, ownerId, brandId) {
  const id = randomUUID();
  const run = (command) => executeFactCommand(db, { ownerId, brandId }, command, factClock);
  assert.deepEqual(await run({ action: "create", id, previousId: null, fields: usableFact }), { id });
  assert.deepEqual(await run({ action: "submit", id, revision: 1 }), { id });
  assert.deepEqual(await run({
    action: "approve", id, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
  }), { id });
  return id;
}

async function seedVersion(db, brand, ownerId, factId) {
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
      VALUES (?, ?, ?, ?, ?, ?, 'fact_faq', '版本标题', '正文', ?, 'in_review', 'fp', ?, ?, 'primary_page', 'unverified', 'unverified', '[]', ?)`,
  [versionId, brand, ownerId, briefId, briefVersionId, unitId, JSON.stringify([claim]), time, time, facts]);
  return versionId;
}

function approve(brandId, versionId) {
  return { action: "approve-content", brandId, versionId, operationId: randomUUID() };
}

async function approvalRows(db, versionId) {
  return queryWithParameters(db, `SELECT id, content_fingerprint AS "contentFingerprint", actor_id AS "actorId"
    FROM content_approval WHERE content_version_id = ? ORDER BY created_at, id`, [versionId]);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: content approval and manual verification follow dual control`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const db = fixture.connection;
      const owner = randomUUID();
      const reviewer = randomUUID();
      const factUser = randomUUID();
      const stranger = randomUUID();
      const brand = randomUUID();
      await addUser(db, owner);
      await addUser(db, reviewer);
      await addUser(db, factUser);
      await addUser(db, stranger);
      await addBrand(db, owner, brand);
      const factId = await approveFact(db, owner, brand);
      const historicalId = await seedVersion(db, brand, owner, factId);
      const first = await approveContent(db, owner, approve(brand, historicalId), clock);
      assert.equal(first.status, "approved");
      assert.equal(first.replayed, false);
      const before = await approvalRows(db, historicalId);

      const saved = await saveApprovalPolicy(db, owner, {
        brandId: brand,
        dualControl: true,
        duties: [
          { userId: reviewer, factApprover: false, contentApprover: true },
          { userId: factUser, factApprover: true, contentApprover: false },
        ],
      }, time);
      assert.equal(saved.dualControl, true);
      const replay = await approveContent(db, owner, approve(brand, historicalId), clock);
      assert.equal(replay.replayed, true);
      assert.equal(replay.approvalId, before[0].id);
      assert.deepEqual(await approvalRows(db, historicalId), before);

      const openId = await seedVersion(db, brand, owner, factId);
      const self = await approveContent(db, owner, approve(brand, openId), clock);
      assert.equal(self.error, "SEPARATION");
      assert.equal((await approvalRows(db, openId)).length, 0);
      const wrongDuty = await approveContent(db, factUser, approve(brand, openId), clock);
      assert.equal(wrongDuty.error, "DUTY");
      assert.deepEqual(await approveContent(db, stranger, approve(brand, openId), clock), { error: "NOT_FOUND" });
      const hidden = await readContentVersion(db, stranger, openId);
      assert.equal(hidden.error, "NOT_FOUND");
      const visible = await readContentVersion(db, reviewer, openId);
      assert.equal(visible.version.id, openId);
      const reviewed = await approveContent(db, reviewer, approve(brand, openId), clock);
      assert.equal(reviewed.status, "approved");
      assert.equal(reviewed.replayed, false);
      const reviewedRow = await approvalRows(db, openId);
      assert.equal(reviewedRow.length, 1);
      assert.equal(reviewedRow[0].actorId, reviewer);
      assert.deepEqual(await approvalRows(db, historicalId), before);

      const publicationId = randomUUID();
      await queryWithParameters(db, `INSERT INTO content_publication (
          id, brand_id, owner_id, content_version_id, approval_id, content_fingerprint,
          target_account, page_url, publisher_id, claimed_published_at, channel_declaration,
          status, effective_at, evidence_grade, superseded_by, operation_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'acct', 'https://ding.example.com/post', ?, ?, 'channel',
          'access_limited', NULL, NULL, NULL, ?, ?, ?)`,
      [publicationId, brand, owner, openId, reviewedRow[0].id, reviewedRow[0].contentFingerprint,
        owner, time, randomUUID(), time, time]);
      const evidence = {
        action: "submit-manual-evidence",
        brandId: brand,
        publicationId,
        screenshotRef: "shot.png",
        pageMarker: "marker-1",
        observedAt: time,
        bodyExcerpt: claim,
      };
      const manualSelf = await submitManualEvidence(db, owner, { ...evidence, operationId: randomUUID() }, clock);
      assert.equal(manualSelf.error, "SEPARATION");
      const [stillLimited] = await queryWithParameters(db, `SELECT status FROM content_publication WHERE id = ?`, [publicationId]);
      assert.equal(stillLimited.status, "access_limited");
      const manualDuty = await submitManualEvidence(db, factUser, { ...evidence, operationId: randomUUID() }, clock);
      assert.equal(manualDuty.error, "DUTY");
      const manualHidden = await readPublication(db, stranger, publicationId);
      assert.equal(manualHidden.error, "NOT_FOUND");
      const manualVisible = await readPublication(db, reviewer, publicationId);
      assert.equal(manualVisible.publication.id, publicationId);
      const manual = await submitManualEvidence(db, reviewer, { ...evidence, operationId: randomUUID() }, clock);
      assert.equal(manual.status, "verified_manual");
      const [check] = await queryWithParameters(db, `SELECT actor_id AS "actorId", result_status AS "resultStatus"
        FROM content_publication_check WHERE publication_id = ?`, [publicationId]);
      assert.equal(check.actorId, reviewer);
      assert.equal(check.resultStatus, "verified_manual");
      assert.deepEqual(await approvalRows(db, historicalId), before);

      const attempts = await queryWithParameters(db, `SELECT version_id AS "versionId", reason, actor_id AS "actorId"
        FROM approval_attempt WHERE brand_id = ? ORDER BY created_at, id`, [brand]);
      assert.deepEqual(attempts.map((row) => `${row.versionId}:${row.reason}:${row.actorId}`).sort(), [
        `${openId}:duty:${factUser}`,
        `${openId}:separation:${owner}`,
        `${publicationId}:duty:${factUser}`,
        `${publicationId}:separation:${owner}`,
      ].sort());

      await saveApprovalPolicy(db, owner, {
        brandId: brand,
        dualControl: false,
        duties: [{ userId: reviewer, factApprover: false, contentApprover: true }],
      }, time);
      const laterId = await seedVersion(db, brand, owner, factId);
      const single = await approveContent(db, owner, approve(brand, laterId), clock);
      assert.equal(single.status, "approved");
      assert.equal((await approvalRows(db, laterId))[0].actorId, owner);
      assert.deepEqual(await approveContent(db, reviewer, approve(brand, laterId), clock), { error: "NOT_FOUND" });
      assert.deepEqual(await approvalRows(db, historicalId), before);
    } finally {
      await fixture.cleanup();
    }
  });
}
