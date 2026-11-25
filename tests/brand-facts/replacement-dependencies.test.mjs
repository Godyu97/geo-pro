import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { executeFactCommand, readFactWorkspace, withEligibleFacts } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { ContentDao } from "../../src/features/content/dao.ts";
import { readContentCalendar } from "../../src/features/content/maintenance.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T11:00:00.000Z";
const clock = (iso = time) => () => new Date(iso);
const titleA = "合成稿件甲-报价说明";
const titleB = "合成稿件乙-适用边界";
const bodyA = "BODY-SECRET-ALPHA-不得出现在依赖列表";
const bodyB = "BODY-SECRET-BETA-不得出现在依赖列表";
const variantBody = "VARIANT-SECRET-GAMMA-不得出现在依赖列表";
const pageUrl = "https://facts.example.com/pages/pricing";
const usable = {
  ...emptyFields,
  category: "price",
  title: "Synthetic plan price",
  claim: "Synthetic 100 CNY",
  sourceType: "url",
  sourceReference: "https://facts.example.com/pricing",
  sourceLocator: "Section 1",
  sourceExcerpt: "Public price excerpt",
  sourceDate: "2026-11-18",
  permission: "public",
  validity: "dated",
  validThrough: "2026-12-31",
};

test("replacement choice copy exists in both locales", () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8")).brandFacts;
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8")).brandFacts;
  for (const key of [
    "revokeConflict", "replacementDependencies", "dependencyDrafts", "dependencyDraftsEmpty",
    "dependencyVariants", "dependencyVariantsEmpty", "dependencyPublications", "dependencyPublicationsEmpty",
  ]) {
    assert.equal(zhCN[key].trim().length > 0, true);
    assert.equal(en[key].trim().length > 0, true);
    assert.notEqual(zhCN[key], en[key]);
  }
});

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Fact replacement owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function count(db, sql, values) {
  const [row] = await queryWithParameters(db, sql, values);
  return Number(row.count);
}

async function seedDraft(db, owner, brand, factId, title, body) {
  const [briefId, briefVersionId, batchId, unitId, versionId] = Array.from({ length: 5 }, () => randomUUID());
  const facts = JSON.stringify([factId]);
  const run = (sql, values) => queryWithParameters(db, sql, values);
  await run(
    "INSERT INTO content_brief (id, brand_id, owner_id, status, created_at, updated_at) VALUES (?, ?, ?, 'confirmed', ?, ?)",
    [briefId, brand, owner, time, time],
  );
  await run(`INSERT INTO content_brief_version (id, brief_id, brand_id, revision, audience, target_gap,
      applicable_boundary, primary_page, conversion_action, template_kind, title_candidates_json,
      fact_version_ids_json, created_at) VALUES (?, ?, ?, 1, 'a', 'g', 'b', 'p', 'c', 'fact_faq', '["t"]', ?, ?)`,
  [briefVersionId, briefId, brand, facts, time]);
  await run(`INSERT INTO content_batch (id, brand_id, owner_id, status, operation_id, cost_ledger_json, created_at, updated_at)
      VALUES (?, ?, ?, 'completed', ?, '{}', ?, ?)`, [batchId, brand, owner, randomUUID(), time, time]);
  await run(`INSERT INTO content_batch_unit (id, batch_id, brief_id, brand_id, status, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'succeeded', 1, ?, ?)`, [unitId, batchId, briefId, brand, time, time]);
  await run(`INSERT INTO content_version (id, brand_id, owner_id, brief_id, brief_version_id, batch_unit_id,
      template_kind, title, body_markdown, claims_json, status, fingerprint, created_at, updated_at,
      target_channel, labeling_profile_version, labeling_profile_status, image_asset_ids_json, fact_version_ids_json)
      VALUES (?, ?, ?, ?, ?, ?, 'fact_faq', ?, ?, '["synthetic"]', 'draft', ?, ?, ?, 'site', 'unverified', 'unverified', '[]', ?)`,
  [versionId, brand, owner, briefId, briefVersionId, unitId, title, body, `fp-${versionId}`, time, time, facts]);
  const bound = await withEligibleFacts(
    db, { ownerId: owner, brandId: brand },
    { factVersionIds: [factId], contentVersionId: versionId, stage: "review" },
    async () => versionId,
    clock(),
  );
  assert.equal(bound.data, versionId);
  return versionId;
}

async function setup(kind) {
  const fixture = await testDatabase(kind);
  const db = fixture.connection;
  const owner = await account(db);
  const stranger = await account(db);
  const brand = randomUUID();
  const brands = new BrandDao(db);
  await brands.insertBrand(owner, brand, time);
  await brands.insertVersion(brand, 1, {
    name: "合成事实品牌",
    description: "Synthetic brand for replacement dependencies",
    website: "https://facts.example.com",
    aliases: [],
    region: "CN",
    language: "zh-CN",
    competitors: [],
    questions: [],
  }, time);
  const scope = { ownerId: owner, brandId: brand };
  const run = (command, at = time) => executeFactCommand(db, scope, command, clock(at));
  const read = (query) => readFactWorkspace(db, scope, query, clock());
  const oldId = randomUUID();
  assert.deepEqual(await run({ action: "create", id: oldId, previousId: null, fields: usable }), { id: oldId });
  assert.deepEqual(await run({ action: "submit", id: oldId, revision: 1 }), { id: oldId });
  assert.deepEqual(await run({
    action: "approve", id: oldId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
  }), { id: oldId });
  const draftA = await seedDraft(db, owner, brand, oldId, titleA, bodyA);
  const draftB = await seedDraft(db, owner, brand, oldId, titleB, bodyB);
  const variantId = randomUUID();
  const approvalId = randomUUID();
  const publicationId = randomUUID();
  const content = new ContentDao(db);
  await content.insertChannelVariant({
    id: variantId,
    brandId: brand,
    ownerId: owner,
    contentVersionId: draftA,
    channel: "site",
    bodyMarkdown: variantBody,
    approvalStatus: "draft",
    approvalId: null,
    needsOwnApproval: 0,
    blocked: 0,
    fingerprint: `variant-${variantId}`,
    channelProfileVersionId: null,
    profileVersionNumber: null,
    profileMaxCharacters: null,
    profileChannelKey: null,
    createdAt: time,
    updatedAt: time,
  });
  await content.insertApproval({
    id: approvalId,
    brandId: brand,
    ownerId: owner,
    contentVersionId: draftA,
    contentFingerprint: `fp-${draftA}`,
    factVersionIdsJson: JSON.stringify([oldId]),
    decision: "approved",
    actorId: owner,
    createdAt: time,
  });
  await content.insertPublication({
    id: publicationId,
    brandId: brand,
    ownerId: owner,
    contentVersionId: draftA,
    approvalId,
    contentFingerprint: `fp-${draftA}`,
    targetAccount: "synthetic-account",
    pageUrl,
    publisherId: "synthetic-publisher",
    claimedPublishedAt: time,
    channelDeclaration: "site",
    status: "submitted",
    effectiveAt: null,
    evidenceGrade: null,
    supersededBy: null,
    operationId: randomUUID(),
    createdAt: time,
    updatedAt: time,
  });
  return { fixture, db, owner, stranger, brand, scope, run, read, oldId, draftA, draftB, variantId, publicationId };
}

function openReplacement(run, oldId) {
  const id = randomUUID();
  return run({
    action: "create",
    id,
    previousId: oldId,
    fields: { ...usable, claim: "Synthetic 120 CNY", validity: "longTerm", validThrough: "" },
  }).then((result) => {
    assert.deepEqual(result, { id });
    return id;
  });
}

function listed(workspace) {
  return JSON.stringify(workspace);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: approving a conflicting fact without revocation keeps drafts and lists dependencies`, async () => {
    const ctx = await setup(kind);
    try {
      const { db, stranger, brand, scope, run, read, oldId, draftA, draftB, variantId, publicationId } = ctx;
      const nextId = await openReplacement(run, oldId);
      const captured = [];
      const observed = {
        kind: db.kind,
        query(sql, values) {
          captured.push({ sql, values });
          return db.query(sql, values);
        },
      };
      const pending = await readFactWorkspace(observed, scope, { fact: nextId }, clock());
      assert.equal(captured.length, 10);
      assert.equal(pending.conflict.id, oldId);
      assert.deepEqual(pending.dependencies.drafts.map((row) => row.id).sort(), [draftA, draftB].sort());
      assert.deepEqual(pending.dependencies.drafts.map((row) => row.status), ["draft", "draft"]);
      assert.equal(pending.dependencies.variants.length, 1);
      assert.equal(pending.dependencies.variants[0].id, variantId);
      assert.equal(pending.dependencies.publications.length, 1);
      assert.equal(pending.dependencies.publications[0].id, publicationId);
      assert.equal(pending.dependencies.publications[0].pageUrl, pageUrl);
      const visible = listed(pending);
      assert.match(visible, new RegExp(titleA));
      assert.match(visible, new RegExp(titleB));
      assert.doesNotMatch(visible, /BODY-SECRET|VARIANT-SECRET/);
      assert.equal(await readFactWorkspace(db, { ownerId: stranger, brandId: brand }, { fact: nextId }, clock()), null);
      const hidden = await new ContentDao(db).listFactDependencies(stranger, brand, oldId);
      assert.deepEqual(hidden.drafts, []);
      assert.equal(listed(hidden).includes(titleA), false);
      assert.equal(listed(hidden).includes(bodyA), false);
      const draftQuery = captured.find((query) => query.sql.includes("v.title") && query.sql.includes("brand_fact_use"));
      const plan = await db.query(`${db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN "}${draftQuery.sql}`, draftQuery.values);
      assert.match(JSON.stringify(plan), /brand_fact_use/);
      console.log(`${kind} replacement dependency plan ${JSON.stringify(plan)}`);

      assert.deepEqual(await run({
        action: "approve", id: nextId, revision: 1, confirmed: true, conflictId: oldId, revokeConflict: false,
      }), { id: nextId });
      const kept = await read({ fact: nextId });
      assert.equal(kept.fact.state, "approved");
      assert.equal(kept.conflict.id, oldId);
      assert.deepEqual(kept.dependencies.drafts.map((row) => row.id).sort(), [draftA, draftB].sort());
      assert.equal(kept.dependencies.publications[0].id, publicationId);
      assert.equal((await read({ fact: oldId })).fact.state, "approved");
      for (const id of [draftA, draftB]) {
        const [row] = await queryWithParameters(db, `SELECT status FROM content_version WHERE id = ?`, [id]);
        assert.equal(row.status, "draft");
      }
      assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 0);

      const approvedBefore = (await queryWithParameters(
        db, `SELECT id FROM brand_fact_version WHERE brand_id = ? AND state = 'approved' ORDER BY id`, [brand],
      )).map((row) => row.id);
      const draftsBefore = await count(db, `SELECT count(*) AS "count" FROM content_version WHERE brand_id = ?`, [brand]);
      const extra = randomUUID();
      assert.deepEqual(await run({
        action: "create", id: extra, previousId: null, fields: { ...usable, title: "Unrelated fact", claim: "Synthetic support hours" },
      }), { id: extra });
      assert.deepEqual(await run({ action: "submit", id: extra, revision: 1 }), { id: extra });
      assert.deepEqual(await run({
        action: "approve", id: extra, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
      }), { id: extra });
      const approvedAfter = (await queryWithParameters(
        db, `SELECT id, state FROM brand_fact_version WHERE brand_id = ? AND id <> ?`, [brand, extra],
      ));
      for (const id of approvedBefore) {
        assert.equal(approvedAfter.find((row) => row.id === id).state, "approved");
      }
      assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_version WHERE brand_id = ?`, [brand]), draftsBefore);
      assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 0);

      const bare = randomUUID();
      assert.deepEqual(await run({
        action: "create", id: bare, previousId: null, fields: { ...usable, claim: "Synthetic bare claim" },
      }), { id: bare });
      assert.deepEqual(await run({ action: "submit", id: bare, revision: 1 }), { id: bare });
      assert.deepEqual(await run({
        action: "approve", id: bare, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
      }), { id: bare });
      const bareNext = await openReplacement(run, bare);
      const empty = await read({ fact: bareNext });
      assert.deepEqual(empty.dependencies, { drafts: [], variants: [], publications: [], more: false });
    } finally {
      await ctx.fixture.cleanup();
    }
  });

  test(`${kind}: revoking the previous version on approval opens one maintenance task`, async () => {
    const ctx = await setup(kind);
    try {
      const { db, owner, brand, run, read, oldId, draftA, draftB, variantId } = ctx;
      const nextId = await openReplacement(run, oldId);
      assert.deepEqual(await run({
        action: "approve", id: nextId, revision: 1, confirmed: true, conflictId: oldId, revokeConflict: true,
      }), { id: nextId });
      const revoked = await read({ fact: oldId });
      assert.equal(revoked.fact.state, "revoked");
      for (const id of [draftA, draftB]) {
        const [row] = await queryWithParameters(db, `SELECT status FROM content_version WHERE id = ?`, [id]);
        assert.equal(row.status, "draft");
      }
      assert.equal(await count(
        db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ? AND status = 'open'`, [brand],
      ), 1);
      const calendar = await readContentCalendar(db, owner, { brandId: brand, factVersionId: oldId });
      assert.equal(calendar.tasks.length, 1);
      assert.equal(calendar.tasks[0].pages.length, 1);
      const page = calendar.tasks[0].pages[0];
      assert.equal(page.draftId, draftA);
      assert.equal(page.variantId, variantId);
      assert.equal(page.pageUrl, pageUrl);
      assert.notEqual(page.draftId, draftB);
      const saved = await read({ fact: nextId });
      assert.equal((await run({
        action: "approve",
        id: nextId,
        revision: saved.fact.revision,
        confirmed: true,
        conflictId: oldId,
        revokeConflict: true,
      })).error, "conflict");
      assert.equal(await count(
        db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ? AND status = 'open'`, [brand],
      ), 1);
      const bare = randomUUID();
      assert.deepEqual(await run({
        action: "create", id: bare, previousId: null, fields: { ...usable, claim: "Synthetic bare claim" },
      }), { id: bare });
      assert.deepEqual(await run({ action: "submit", id: bare, revision: 1 }), { id: bare });
      assert.deepEqual(await run({
        action: "approve", id: bare, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
      }), { id: bare });
      const bareNext = await openReplacement(run, bare);
      assert.deepEqual(await run({
        action: "approve", id: bareNext, revision: 1, confirmed: true, conflictId: bare, revokeConflict: true,
      }), { id: bareNext });
      assert.equal((await read({ fact: bare })).fact.state, "revoked");
      assert.equal(await count(
        db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ? AND status = 'open'`, [brand],
      ), 1);
    } finally {
      await ctx.fixture.cleanup();
    }
  });
}
