import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  approveContent,
  confirmBrief,
  generateBatch,
  markPublicationRemoved,
  saveBriefDraft,
  submitReview,
  updateVariant,
  verifyPublication,
} from "../../src/features/content/commands.ts";
import { ContentDao } from "../../src/features/content/dao.ts";
import {
  openContentMaintenance,
  readContentCalendar,
  scanExpiredContentMaintenance,
  settleContentMaintenance,
} from "../../src/features/content/maintenance.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T11:00:00.000Z";
const expiredAt = "2027-01-15T00:00:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);
const channels = ["site", "zhihu", "wechat", "baijiahao", "toutiao"];
const usableFact = {
  ...emptyFields,
  category: "price",
  title: "Synthetic plan price",
  claim: "Synthetic 100 CNY",
  sourceType: "url",
  sourceReference: "https://geng.example.com/pricing",
  sourceLocator: "Section 1",
  sourceExcerpt: "Public price excerpt",
  sourceDate: "2026-11-18",
  permission: "public",
  validity: "dated",
  validThrough: "2026-12-31",
};

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Calendar owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function count(db, sql, values) {
  const [row] = await queryWithParameters(db, sql, values);
  return Number(row.count);
}

async function setup(t, kind) {
  const fixture = await testDatabase(kind);
  t.after(() => fixture.cleanup());
  const db = fixture.connection;
  const owner = await account(db);
  const brand = randomUUID();
  const brands = new BrandDao(db);
  await brands.insertBrand(owner, brand, time);
  await brands.insertVersion(brand, 1, {
    name: "庚品牌",
    description: "Synthetic brand for maintenance triggers",
    website: "https://geng.example.com",
    aliases: ["庚"],
    region: "CN",
    language: "zh-CN",
    competitors: [],
    questions: [],
  }, time);
  const factId = randomUUID();
  const run = (command, at = factClock) => executeFactCommand(db, { ownerId: owner, brandId: brand }, command, at);
  assert.deepEqual(await run({ action: "create", id: factId, previousId: null, fields: usableFact }), { id: factId });
  assert.deepEqual(await run({ action: "submit", id: factId, revision: 1 }), { id: factId });
  assert.deepEqual(await run({
    action: "approve", id: factId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
  }), { id: factId });
  const saved = await saveBriefDraft(db, owner, {
    action: "save-brief-draft",
    brandId: brand,
    operationId: randomUUID(),
    questionCluster: `cluster-${randomUUID()}`,
    fields: {
      audience: "采购负责人",
      targetGap: "价格口径不清晰",
      applicableBoundary: "仅适用于公开报价页",
      primaryPage: "https://geng.example.com/pricing",
      conversionAction: "预约演示",
      templateKind: "fact_faq",
      titleCandidates: ["公开报价怎么看"],
      factVersionIds: [factId],
      competitorSource: null,
    },
  }, clock);
  assert.equal(saved.error, undefined);
  const confirmed = await confirmBrief(db, owner, {
    action: "confirm-brief", brandId: brand, briefId: saved.briefId, operationId: randomUUID(),
  }, clock);
  assert.equal(confirmed.error, undefined);
  const batch = await generateBatch(db, owner, {
    action: "generate-batch", brandId: brand, operationId: randomUUID(), briefIds: [saved.briefId],
  }, clock);
  assert.equal(batch.error, undefined);
  const versionId = batch.units[0].contentVersionId;
  assert.equal((await updateVariant(db, owner, {
    action: "update-variant",
    brandId: brand,
    operationId: randomUUID(),
    versionId,
    labelingProfileVersion: "profile-2026-11",
    labelingProfileStatus: "verified",
  }, clock)).error, undefined);
  assert.equal((await submitReview(db, owner, {
    action: "submit-review", brandId: brand, operationId: randomUUID(), versionId,
  }, clock)).status, "in_review");
  const approved = await approveContent(db, owner, {
    action: "approve-content", brandId: brand, operationId: randomUUID(), versionId,
  }, clock);
  assert.equal(approved.error, undefined);
  const dao = new ContentDao(db);
  const publications = [];
  for (const channel of channels) {
    const id = randomUUID();
    await dao.insertPublication({
      id,
      brandId: brand,
      ownerId: owner,
      contentVersionId: versionId,
      approvalId: approved.approvalId,
      contentFingerprint: approved.contentFingerprint,
      targetAccount: "synthetic-account",
      pageUrl: `https://geng.example.com/pages/${channel}`,
      publisherId: "synthetic-publisher",
      claimedPublishedAt: time,
      channelDeclaration: channel,
      status: "submitted",
      effectiveAt: null,
      evidenceGrade: null,
      supersededBy: null,
      operationId: randomUUID(),
      createdAt: time,
      updatedAt: time,
    });
    publications.push({ id, channel });
  }
  return { db, owner, brand, factId, versionId, publications, run };
}

function taskPages(calendar) {
  assert.equal(calendar.error, undefined);
  assert.equal(calendar.tasks.length, 1);
  return calendar.tasks[0];
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: revoking one fact opens a single maintenance task for five pages`, async (t) => {
    const { db, owner, brand, factId, versionId, publications, run } = await setup(t, kind);
    const lone = randomUUID();
    assert.equal((await run({ action: "create", id: lone, previousId: null, fields: usableFact })).id, lone);
    assert.equal((await run({ action: "submit", id: lone, revision: 1 })).id, lone);
    assert.equal((await run({
      action: "approve", id: lone, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
    })).id, lone);
    assert.equal((await run({ action: "revoke", id: lone, revision: 3, confirmed: true })).id, lone);
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 0);

    const [fact] = await queryWithParameters(db, `SELECT revision FROM brand_fact_version WHERE id = ?`, [factId]);
    assert.equal((await run({ action: "revoke", id: factId, revision: Number(fact.revision), confirmed: true })).id, factId);
    const opened = taskPages(await readContentCalendar(db, owner, { brandId: brand, factVersionId: factId }));
    assert.equal(opened.reason, "revoked");
    assert.equal(opened.pages.length, 5);
    assert.deepEqual(opened.pages.map((page) => page.pageUrl).sort(), channels.map((channel) => `https://geng.example.com/pages/${channel}`).sort());
    assert.equal(opened.pages.every((page) => page.draftId === versionId && page.variantId === null && page.published === false), true);

    const scheduled = await openContentMaintenance(db, owner, {
      action: "open-maintenance",
      brandId: brand,
      factVersionId: factId,
      reason: "revoked",
      schedules: publications.map((page) => ({ pageId: page.id, plannedOn: "2026-11-01", verifiedOn: null })),
    }, () => expiredAt);
    assert.equal(scheduled.taskId, opened.id);
    assert.equal(scheduled.created, false);
    assert.equal(scheduled.pages.every((page) => page.plannedOn === "2026-11-01" && page.status === "planned"), true);
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 1);
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_page WHERE brand_id = ?`, [brand]), 5);
  });

  test(`${kind}: an expiry scan keeps one task and a blocked channel stays independent`, async (t) => {
    const { db, owner, brand, factId } = await setup(t, kind);
    const early = await scanExpiredContentMaintenance(db, owner, brand, clock);
    assert.equal(early.scanned, 0);
    assert.equal(early.opened, 0);
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 0);

    const scanned = await scanExpiredContentMaintenance(db, owner, brand, () => expiredAt);
    assert.equal(scanned.scanned, 1);
    assert.equal(scanned.opened, 1);
    assert.equal(scanned.tasks.length, 1);
    assert.equal(scanned.tasks[0].pageCount, 5);
    const again = await scanExpiredContentMaintenance(db, owner, brand, () => expiredAt);
    assert.equal(again.opened, 0);
    assert.equal(again.tasks[0].taskId, scanned.tasks[0].taskId);
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 1);

    const settled = await settleContentMaintenance(db, owner, {
      action: "settle-maintenance",
      brandId: brand,
      taskId: scanned.tasks[0].taskId,
      channels: [
        { channel: "site", state: "verified", verifiedOn: "2026-11-20" },
        { channel: "wechat", state: "verified", verifiedOn: "2026-11-20" },
        { channel: "zhihu", state: "blocked" },
      ],
    }, () => expiredAt);
    assert.deepEqual(settled.rolledBack, []);
    const pages = new Map(settled.pages.map((page) => [page.channel, page]));
    assert.equal(pages.get("site").status, "verified");
    assert.equal(pages.get("wechat").status, "verified");
    assert.equal(pages.get("site").verifiedOn, "2026-11-20");
    assert.equal(pages.get("zhihu").status, "blocked");
    assert.equal(pages.get("baijiahao").status, "planned");
    assert.equal(pages.get("toutiao").status, "planned");
    const calendar = taskPages(await readContentCalendar(db, owner, { brandId: brand, factVersionId: factId }));
    assert.equal(calendar.reason, "expired");
    assert.equal(calendar.pages.find((page) => page.channel === "site").status, "verified");
    assert.equal(calendar.pages.find((page) => page.channel === "zhihu").status, "blocked");

    const plan = await queryWithParameters(db,
      `${db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN "}SELECT id FROM (
         SELECT DISTINCT u.fact_version_id AS id
         FROM brand_fact_use u
         JOIN content_publication p
           ON p.brand_id = u.brand_id AND p.content_version_id = u.content_version_id AND p.owner_id = ?
         JOIN brand b ON b.id = u.brand_id AND b.owner_id = ? AND b.frozen_at IS NULL
         WHERE u.brand_id = ?
       ) linked_facts ORDER BY id ASC LIMIT ?`,
      [owner, owner, brand, 50],
    );
    assert.match(JSON.stringify(plan), /brand_fact_use|fact_use_content_idx|brand_fact_use_pkey/);
  });

  test(`${kind}: mismatch and removal share one task and keep the removed page`, async (t) => {
    const { db, owner, brand, factId, publications } = await setup(t, kind);
    const removed = publications[0];
    const marked = await markPublicationRemoved(db, owner, {
      action: "mark-publication-removed",
      brandId: brand,
      operationId: randomUUID(),
      publicationId: removed.id,
      reason: "The platform took the page down.",
    }, clock);
    assert.equal(marked.status, "removed");
    const opened = taskPages(await readContentCalendar(db, owner, { brandId: brand, factVersionId: factId }));
    assert.equal(opened.reason, "removed");
    assert.equal(opened.pages.length, 5);
    assert.equal(opened.pages.some((page) => page.pageId === removed.id), true);

    const checked = await verifyPublication(db, owner, {
      action: "verify-publication",
      brandId: brand,
      operationId: randomUUID(),
      publicationId: publications[1].id,
      fixturePage: {
        accessClass: "public",
        httpStatus: 200,
        title: "Changed",
        bodyText: "The live page no longer states the approved price.",
      },
    }, clock);
    assert.equal(checked.status, "mismatch");
    const repeated = await verifyPublication(db, owner, {
      action: "verify-publication",
      brandId: brand,
      operationId: randomUUID(),
      publicationId: publications[1].id,
      fixturePage: {
        accessClass: "public",
        httpStatus: 200,
        title: "Changed again",
        bodyText: "Still not the approved price.",
      },
    }, clock);
    assert.equal(repeated.status, "mismatch");
    const after = taskPages(await readContentCalendar(db, owner, { brandId: brand, factVersionId: factId }));
    assert.equal(after.id, opened.id);
    assert.equal(after.reason, "removed");
    assert.equal(after.pages.length, 5);
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 1);
  });
}
