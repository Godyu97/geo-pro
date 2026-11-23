import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { publishChannelProfile } from "../../src/features/channel-variants/commands.ts";
import { variantNeedsOwnApproval, variantRejection } from "../../src/features/channel-variants/rules.ts";
import {
  approveChannelVariant,
  approveContent,
  blockChannelVariant,
  confirmBrief,
  exportChannelVariant,
  generateBatch,
  readChannelVariant,
  readContentVersion,
  saveBriefDraft,
  saveChannelVariant,
  submitReview,
  updateVariant,
} from "../../src/features/content/commands.ts";
import { contentErrors } from "../../src/features/content/contracts.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const storageEnv = {
  S3_ENDPOINT: "http://127.0.0.1:9",
  S3_REGION: "us-east-1",
  S3_BUCKET: "app-files",
  S3_ACCESS_KEY_ID: "local-app",
  S3_SECRET_ACCESS_KEY: "s3-secret-not-for-logs",
  S3_FORCE_PATH_STYLE: "true",
};

function memoryStorage() {
  const objects = new Map();
  return {
    objects,
    async putAndReadBack({ key, body, contentType }) {
      const sha256 = createHash("sha256").update(body).digest("hex");
      objects.set(key, body);
      return { ok: true, status: "ready", bucket: "app-files", key, byteSize: body.byteLength, sha256, contentType };
    },
    async getObject({ key }) {
      const body = objects.get(key);
      if (!body) return { ok: false, status: "failed", code: "unavailable" };
      return { ok: true, body, byteSize: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") };
    },
    async deleteObject() {
      return { ok: true };
    },
    async presignGet() {
      return { ok: false, status: "failed", code: "unavailable" };
    },
  };
}

const time = "2026-11-22T11:00:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);
const brandFields = {
  name: "戊品牌",
  description: "Synthetic brand for channel variants",
  website: "https://wu.example.com",
  aliases: ["戊"],
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
  sourceReference: "https://wu.example.com/pricing",
  sourceLocator: "Section 1",
  sourceExcerpt: "Public price excerpt",
  sourceDate: "2026-11-18",
  permission: "public",
  validity: "dated",
  validThrough: "2026-12-31",
};

test("pure: 沿用主稿批准 in the body does not bypass variantNeedsOwnApproval", () => {
  const master = "价格 100 元";
  const variant = { id: "v", channel: "zhihu", approved: true, body: `${master}\n沿用主稿批准` };
  assert.equal(variantNeedsOwnApproval(true, variant, master), true);
  assert.equal(variantRejection({
    masterApproved: true,
    variant,
    masterBody: master,
    blocked: false,
  }), "body_diverged");
  assert.equal(contentErrors.NOT_FOUND, 404);
  assert.equal(contentErrors.VARIANT_REAPPROVAL_REQUIRED, 422);
});

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Variant owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
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
  const storage = memoryStorage();
  const packageOptions = { env: storageEnv, storage, now: new Date(time) };

  async function approvedVersion() {
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
        primaryPage: "https://wu.example.com/pricing",
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
    const base = { brandId: brand, operationId: randomUUID(), versionId };
    assert.equal((await updateVariant(db, owner, {
      action: "update-variant",
      ...base,
      operationId: randomUUID(),
      labelingProfileVersion: "profile-2026-11",
      labelingProfileStatus: "verified",
    }, clock)).error, undefined);
    assert.equal((await submitReview(db, owner, { action: "submit-review", ...base, operationId: randomUUID() }, clock)).status, "in_review");
    const approved = await approveContent(db, owner, { action: "approve-content", ...base, operationId: randomUUID() }, clock);
    assert.equal(approved.error, undefined);
    const detail = await readContentVersion(db, owner, versionId);
    assert.equal(detail.error, undefined);
    return { versionId, body: detail.version.bodyMarkdown, approvalId: approved.approvalId };
  }

  const count = async (sql, values) => {
    const [row] = await queryWithParameters(db, sql, values);
    return Number(row.n);
  };
  const approvals = async (versionId) => queryWithParameters(
    db,
    `SELECT id, content_fingerprint AS "contentFingerprint", decision, actor_id AS "actorId", created_at AS "createdAt"
     FROM content_approval WHERE content_version_id = ? ORDER BY id`,
    [versionId],
  );

  async function pin(channel) {
    const published = await publishChannelProfile(db, owner, {
      brandId: brand,
      channelKey: channel,
      maxCharacters: null,
      note: "审批回归不设字数上限",
    }, clock);
    assert.equal(published.error, undefined);
    return published.version.id;
  }

  return { db, owner, outsider, brand, packageOptions, approvedVersion, count, approvals, pin };
}

for (const kind of ["sqlite", "postgresql"]) {
  const run = (name, body) => test(`${kind}: ${name}`, async (t) => {
    await body(t, await setup(t, kind));
  });

  run("changed price cannot inherit the master approval", async (t, ctx) => {
    const { db, owner, outsider, brand, packageOptions, approvedVersion, count, approvals, pin } = ctx;
    const { versionId, body, approvalId } = await approvedVersion();
    assert.match(body, /100/);
    const changed = body.replace("100", "101");
    assert.notEqual(changed, body);
    const before = await approvals(versionId);
    const packagesBefore = await count(
      `SELECT count(*) AS n FROM content_delivery_package WHERE brand_id = ?`,
      [brand],
    );
    const saved = await saveChannelVariant(db, owner, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "zhihu",
      bodyMarkdown: changed,
      profileVersionId: await pin("zhihu"),
    }, clock);
    assert.equal(saved.error, undefined);
    assert.equal(saved.variant.needsOwnApproval, true);
    assert.equal(saved.variant.rejection, "body_diverged");
    assert.equal(saved.variant.approvalId, null);
    const [stored] = await queryWithParameters(
      db,
      `SELECT needs_own_approval AS "needsOwnApproval" FROM content_channel_variant WHERE id = ?`,
      [saved.variant.id],
    );
    assert.equal(Number(stored.needsOwnApproval), 1);

    const exported = await exportChannelVariant(db, owner, {
      action: "export-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "zhihu",
    }, clock, packageOptions);
    assert.equal(exported.error, "VARIANT_REAPPROVAL_REQUIRED");
    assert.equal(await count(`SELECT count(*) AS n FROM content_delivery_package WHERE brand_id = ?`, [brand]), packagesBefore);
    assert.deepEqual(await approvals(versionId), before);
    assert.equal(before.some((row) => row.id === approvalId), true);

    const phrase = await saveChannelVariant(db, owner, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "toutiao",
      bodyMarkdown: `${body}\n沿用主稿批准`,
      profileVersionId: await pin("toutiao"),
    }, clock);
    assert.equal(phrase.variant.needsOwnApproval, true);
    assert.equal(phrase.variant.rejection, "body_diverged");
    const phraseExport = await exportChannelVariant(db, owner, {
      action: "export-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "toutiao",
    }, clock, packageOptions);
    assert.equal(phraseExport.error, "VARIANT_REAPPROVAL_REQUIRED");
    assert.deepEqual(await approvals(versionId), before);

    const hidden = await readChannelVariant(db, outsider, saved.variant.id);
    assert.equal(hidden.error, "NOT_FOUND");
    assert.equal(contentErrors[hidden.error], 404);
    const deniedSave = await saveChannelVariant(db, outsider, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "zhihu",
      bodyMarkdown: changed,
    }, clock);
    assert.equal(deniedSave.error, "NOT_FOUND");
  });

  run("same body with its own approval exports one package", async (t, ctx) => {
    const { db, owner, brand, packageOptions, approvedVersion, count, approvals, pin } = ctx;
    const { versionId, body, approvalId } = await approvedVersion();
    const before = await approvals(versionId);
    const packagesBefore = await count(
      `SELECT count(*) AS n FROM content_delivery_package WHERE brand_id = ?`,
      [brand],
    );
    const saved = await saveChannelVariant(db, owner, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "zhihu",
      bodyMarkdown: body,
      profileVersionId: await pin("zhihu"),
    }, clock);
    assert.equal(saved.error, undefined);
    assert.equal(saved.variant.needsOwnApproval, true);
    assert.equal(saved.variant.rejection, "variant_unapproved");
    const approved = await approveChannelVariant(db, owner, {
      action: "approve-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "zhihu",
    }, clock);
    assert.equal(approved.error, undefined);
    assert.equal(approved.variant.needsOwnApproval, false);
    assert.notEqual(approved.approvalId, approvalId);
    const exported = await exportChannelVariant(db, owner, {
      action: "export-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "zhihu",
    }, clock, packageOptions);
    assert.equal(exported.error, undefined);
    assert.equal(exported.approvalId, approved.approvalId);
    assert.notEqual(exported.approvalId, approvalId);
    assert.equal(exported.package.targetChannel, "zhihu");
    assert.equal(await count(`SELECT count(*) AS n FROM content_delivery_package WHERE brand_id = ?`, [brand]), packagesBefore + 1);
    const after = await approvals(versionId);
    const master = after.find((row) => row.id === approvalId);
    assert.deepEqual(master, before.find((row) => row.id === approvalId));
  });

  run("blocking one channel leaves the other approval unchanged", async (t, ctx) => {
    const { db, owner, brand, approvedVersion, pin } = ctx;
    const { versionId, body } = await approvedVersion();
    const save = async (channel) => saveChannelVariant(db, owner, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel,
      bodyMarkdown: body,
      profileVersionId: await pin(channel),
    }, clock);
    const first = await save("zhihu");
    const second = await save("baijiahao");
    assert.equal(first.error, undefined);
    assert.equal(second.error, undefined);
    const approved = await approveChannelVariant(db, owner, {
      action: "approve-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "baijiahao",
    }, clock);
    assert.equal(approved.variant.approvalStatus, "approved");
    const blocked = await blockChannelVariant(db, owner, {
      action: "block-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "zhihu",
    }, clock);
    assert.equal(blocked.error, undefined);
    assert.equal(blocked.variant.blocked, true);
    assert.equal(blocked.variant.approvalStatus, "draft");
    const other = await readChannelVariant(db, owner, second.variant.id);
    assert.equal(other.variant.approvalStatus, "approved");
    assert.equal(other.variant.approvalId, approved.approvalId);
    assert.equal(other.variant.blocked, false);
    const [statuses] = await Promise.all([
      queryWithParameters(
        db,
        `SELECT channel, approval_status AS "approvalStatus", blocked
         FROM content_channel_variant WHERE content_version_id = ? ORDER BY channel`,
        [versionId],
      ),
    ]);
    assert.deepEqual(statuses.map((row) => ({
      channel: row.channel,
      approvalStatus: row.approvalStatus,
      blocked: Number(row.blocked),
    })), [
      { channel: "baijiahao", approvalStatus: "approved", blocked: 0 },
      { channel: "zhihu", approvalStatus: "draft", blocked: 1 },
    ]);
  });
}
