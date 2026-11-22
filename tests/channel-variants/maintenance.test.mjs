import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { calendarRow, impactSurface, settleChannels } from "../../src/features/channel-variants/rules.ts";
import {
  approveContent,
  confirmBrief,
  generateBatch,
  saveBriefDraft,
  submitReview,
  updateVariant,
} from "../../src/features/content/commands.ts";
import { maintenanceWriteSchema } from "../../src/features/content/contracts.ts";
import { ContentDao } from "../../src/features/content/dao.ts";
import {
  openContentMaintenance,
  readContentCalendar,
  settleContentMaintenance,
} from "../../src/features/content/maintenance.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T11:00:00.000Z";
const expiredAt = "2027-01-15T00:00:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);
const brandFields = {
  name: "庚品牌",
  description: "Synthetic brand for the content calendar",
  website: "https://geng.example.com",
  aliases: ["庚"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};
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
const channels = ["site", "zhihu", "wechat", "baijiahao", "toutiao"];

test("five affected pages stay one task and a blocked channel does not roll back verification", () => {
  const factId = randomUUID();
  const pages = channels.map((channel) => ({
    pageId: randomUUID(),
    draftId: randomUUID(),
    channel,
  }));
  const impact = impactSurface({ factId, pages });
  assert.equal(impact.pages.length, 5);
  assert.equal(impact.taskCount, 1);
  assert.equal(calendarRow({ plannedOn: "2026-11-01", verifiedOn: null, blocked: false }).published, false);
  const settled = settleChannels([
    { channel: "site", state: "verified" },
    { channel: "wechat", state: "verified" },
    { channel: "zhihu", state: "blocked" },
  ]);
  assert.deepEqual(settled.rolledBack, []);
  assert.deepEqual(settled.verified, ["site", "wechat"]);
  assert.deepEqual(settled.blocked, ["zhihu"]);
  const zh = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8")).content;
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8")).content;
  assert.equal(zh.plannedOn, "计划日");
  assert.equal(zh.plannedOn.includes("上线"), false);
  assert.equal(en.plannedOn, "Planned date");
  assert.equal(/live|published/i.test(en.plannedOn), false);
  assert.equal(zh.verifiedOn === zh.plannedOn, false);
  const brandId = randomUUID();
  assert.equal(maintenanceWriteSchema.safeParse({
    action: "open-maintenance",
    brandId,
    factVersionId: factId,
    reason: "expired",
    published: true,
  }).success, false);
});

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

function watch(db) {
  const captured = [];
  return {
    captured,
    connection: {
      kind: db.kind,
      query(sql, values) {
        captured.push({ sql, values });
        return db.query(sql, values);
      },
      transaction: (work) => db.transaction((tx) => work({
        kind: db.kind,
        query(sql, values) {
          captured.push({ sql, values });
          return tx.query(sql, values);
        },
        savepoint: tx.savepoint.bind(tx),
      })),
    },
  };
}

async function setup(t, kind) {
  const fixture = await testDatabase(kind);
  t.after(() => fixture.cleanup());
  const db = fixture.connection;
  const [owner, outsider] = await Promise.all([account(db), account(db)]);
  const brands = new BrandDao(db);
  const brand = randomUUID();
  await brands.insertBrand(owner, brand, time);
  await brands.insertVersion(brand, 1, brandFields, time);
  const factId = randomUUID();
  const run = (command) => executeFactCommand(db, { ownerId: owner, brandId: brand }, command, factClock);
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
    publications.push({ id, channel, pageUrl: `https://geng.example.com/pages/${channel}` });
  }
  return { db, owner, outsider, brand, factId, versionId, publications };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: one fact expiry keeps a single maintenance task and blocked channels stay independent`, async (t) => {
    const { db, owner, outsider, brand, factId, versionId, publications } = await setup(t, kind);
    const schedules = publications.map((page) => ({
      pageId: page.id,
      plannedOn: "2026-11-01",
      verifiedOn: null,
    }));
    const openInput = {
      action: "open-maintenance",
      brandId: brand,
      factVersionId: factId,
      reason: "expired",
      schedules,
    };
    const tooEarly = await openContentMaintenance(db, owner, openInput, clock);
    assert.equal(tooEarly.error, "FACT_INVALID");
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 0);

    const opened = await openContentMaintenance(db, owner, openInput, () => expiredAt);
    assert.equal(opened.error, undefined);
    assert.equal(opened.taskCount, 1);
    assert.equal(opened.created, true);
    assert.equal(opened.pageCount, 5);
    assert.equal(opened.pages.length, 5);
    assert.equal(opened.pages.every((page) => page.plannedOn === "2026-11-01" && page.verifiedOn === null && page.published === false), true);
    assert.deepEqual(opened.pages.map((page) => page.pageUrl).sort(), publications.map((page) => page.pageUrl).sort());

    const again = await openContentMaintenance(db, owner, openInput, () => expiredAt);
    assert.equal(again.taskId, opened.taskId);
    assert.equal(again.created, false);
    assert.equal(again.pageCount, 5);
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 1);
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_page WHERE brand_id = ?`, [brand]), 5);

    const revokedTooSoon = await openContentMaintenance(db, owner, { ...openInput, reason: "revoked" }, () => expiredAt);
    assert.equal(revokedTooSoon.error, "FACT_INVALID");
    const [fact] = await queryWithParameters(db, `SELECT revision FROM brand_fact_version WHERE id = ?`, [factId]);
    assert.deepEqual(await executeFactCommand(db, { ownerId: owner, brandId: brand }, {
      action: "revoke", id: factId, revision: Number(fact.revision), confirmed: true,
    }, factClock), { id: factId });
    const revoked = await openContentMaintenance(db, owner, { ...openInput, reason: "revoked" }, () => expiredAt);
    assert.equal(revoked.taskId, opened.taskId);
    assert.equal(revoked.pageCount, 5);
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 1);

    const verified = await settleContentMaintenance(db, owner, {
      action: "settle-maintenance",
      brandId: brand,
      taskId: opened.taskId,
      channels: ["site", "zhihu", "wechat"].map((channel) => ({
        channel, state: "verified", verifiedOn: "2026-11-20",
      })),
    }, () => expiredAt);
    assert.deepEqual(verified.rolledBack, []);
    assert.deepEqual(verified.verified.sort(), ["site", "wechat", "zhihu"]);
    const verifiedPages = new Map(verified.pages.map((page) => [page.channel, page]));
    for (const channel of ["site", "zhihu", "wechat"]) {
      const page = verifiedPages.get(channel);
      assert.equal(page.status, "verified");
      assert.equal(page.published, true);
      assert.equal(page.plannedOn, "2026-11-01");
      assert.equal(page.verifiedOn, "2026-11-20");
      assert.equal(Object.hasOwn(page, "liveOn"), false);
    }
    assert.equal(verifiedPages.get("baijiahao").published, false);
    assert.equal(verifiedPages.get("toutiao").status, "planned");

    const blocked = await settleContentMaintenance(db, owner, {
      action: "settle-maintenance",
      brandId: brand,
      taskId: opened.taskId,
      channels: [{ channel: "zhihu", state: "blocked" }],
    }, () => expiredAt);
    assert.deepEqual(blocked.rolledBack, []);
    assert.deepEqual(blocked.blocked, ["zhihu"]);
    assert.equal(blocked.verified.includes("zhihu"), false);
    const after = new Map(blocked.pages.map((page) => [page.channel, page]));
    assert.equal(after.get("zhihu").status, "blocked");
    assert.equal(after.get("zhihu").verifiedOn, "2026-11-20");
    assert.equal(after.get("site").status, "verified");
    assert.equal(after.get("wechat").status, "verified");
    assert.equal(after.get("baijiahao").status, "planned");
    assert.equal(after.get("toutiao").status, "planned");
    assert.equal(["site", "wechat", "zhihu"].some((channel) => after.get(channel).status === "planned"), false);

    const replay = await openContentMaintenance(db, owner, { ...openInput, reason: "revoked" }, () => expiredAt);
    assert.equal(replay.taskId, opened.taskId);
    assert.equal(replay.pages.find((page) => page.channel === "zhihu").status, "blocked");
    assert.equal(replay.pages.find((page) => page.channel === "site").status, "verified");

    const hidden = await openContentMaintenance(db, outsider, { ...openInput, reason: "revoked" }, () => expiredAt);
    assert.equal(hidden.error, "NOT_FOUND");
    assert.equal(JSON.stringify(hidden).includes("geng.example.com"), false);
    const hiddenCalendar = await readContentCalendar(db, outsider, { brandId: brand });
    assert.equal(hiddenCalendar.error, "NOT_FOUND");
    assert.equal(JSON.stringify(hiddenCalendar).includes("geng.example.com"), false);

    const watched = watch(db);
    const calendar = await readContentCalendar(watched.connection, owner, { brandId: brand, factVersionId: factId });
    assert.equal(calendar.tasks.length, 1);
    assert.equal(calendar.tasks[0].pages.length, 5);
    const pageQueries = watched.captured.filter((item) => item.sql.includes("FROM content_maintenance_page"));
    assert.equal(pageQueries.length, 1);
    assert.equal(pageQueries[0].sql.includes("task_id IN"), true);
    assert.equal(pageQueries[0].sql.includes("page_id ="), false);

    const fillerTasks = Array.from({ length: 80 }, () => randomUUID());
    for (let index = 0; index < fillerTasks.length; index += 20) {
      const chunk = fillerTasks.slice(index, index + 20);
      await queryWithParameters(db, `INSERT INTO content_maintenance_task (
        id, brand_id, owner_id, fact_version_id, status, reason, created_at, updated_at
      ) VALUES ${chunk.map(() => "(?, ?, ?, ?, 'closed', 'expired', ?, ?)").join(", ")}`,
      chunk.flatMap((id) => [id, brand, owner, factId, time, time]));
    }
    const fillerPages = fillerTasks.flatMap((taskId) => channels.map((channel) => ({
      id: randomUUID(),
      taskId,
      channel,
    })));
    for (let index = 0; index < fillerPages.length; index += 40) {
      const chunk = fillerPages.slice(index, index + 40);
      await queryWithParameters(db, `INSERT INTO content_maintenance_page (
        id, task_id, brand_id, owner_id, page_id, draft_id, page_url, channel,
        planned_on, verified_on, status, created_at, updated_at
      ) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'planned', ?, ?)").join(", ")}`,
      chunk.flatMap((page) => [
        page.id, page.taskId, brand, owner, randomUUID(), versionId,
        `https://geng.example.com/pad/${page.id}`, page.channel, time, time,
      ]));
    }
    await queryWithParameters(db, "ANALYZE content_maintenance_page");
    const plan = await db.query(
      `${db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN "}${pageQueries[0].sql}`,
      pageQueries[0].values,
    );
    assert.match(JSON.stringify(plan), /content_maintenance_page_task_idx/);
    console.log(`${kind} maintenance page batch uses content_maintenance_page_task_idx among ${fillerPages.length} stored pages`);

    await db.transaction((tx) => new PurgeDao(tx).clearContents({ ownerId: owner, brandId: brand }, time));
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_page WHERE brand_id = ?`, [brand]), 0);
    assert.equal(await count(db, `SELECT count(*) AS "count" FROM content_maintenance_task WHERE brand_id = ?`, [brand]), 0);
  });
}
