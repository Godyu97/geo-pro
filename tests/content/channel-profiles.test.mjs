import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { listChannelProfiles, publishChannelProfile } from "../../src/features/channel-variants/commands.ts";
import { publishChannelProfileSchema } from "../../src/features/channel-variants/contracts.ts";
import { channelProfileVersionListQuery } from "../../src/features/channel-variants/dao.ts";
import { characterCount, exceedsPinnedCharacterLimit } from "../../src/features/channel-variants/rules.ts";
import {
  approveChannelVariant,
  approveContent,
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
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T11:00:00.000Z";
const later = "2026-11-22T12:05:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);
const storageEnv = {
  S3_ENDPOINT: "http://127.0.0.1:9",
  S3_REGION: "us-east-1",
  S3_BUCKET: "app-files",
  S3_ACCESS_KEY_ID: "local-app",
  S3_SECRET_ACCESS_KEY: "s3-secret-not-for-logs",
  S3_FORCE_PATH_STYLE: "true",
};
const brandFields = {
  name: "己品牌",
  description: "Synthetic brand for channel profiles",
  website: "https://ji.example.com",
  aliases: ["己"],
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
  sourceReference: "https://ji.example.com/pricing",
  sourceLocator: "Section 1",
  sourceExcerpt: "Public price excerpt",
  sourceDate: "2026-11-18",
  permission: "public",
  validity: "dated",
  validThrough: "2026-12-31",
};

function profileBaselineTag(kind) {
  const folder = kind === "sqlite" ? "drizzle/sqlite" : "drizzle";
  const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, "utf8"));
  const baseline = kind === "sqlite" ? "0072_broad_snowbird" : "0073_swift_cardiac";
  const index = journal.entries.findIndex(({ tag }) => tag === baseline);
  assert.notEqual(index, -1, `Unknown migration ${baseline}`);
  const next = journal.entries[index + 1];
  assert.ok(next, `Missing migration after ${baseline}`);
  const sql = readFileSync(`${folder}/${next.tag}.sql`, "utf8");
  assert.match(sql, /CREATE TABLE [`"]channel_profile[`"]/);
  return baseline;
}

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

function watch(db) {
  const captured = [];
  const wrap = (target) => ({
    kind: target.kind,
    query(sql, values) {
      captured.push({ sql, values });
      return target.query(sql, values);
    },
    transaction: target.transaction
      ? (work) => target.transaction((tx) => work(wrap(tx)))
      : undefined,
  });
  return { captured, connection: wrap(db) };
}

test("profile limits are per published version and are not platform constants", () => {
  assert.equal(characterCount("一二三四"), 4);
  assert.equal(characterCount("👍"), 1);
  assert.equal(exceedsPinnedCharacterLimit("👍", 1), false);
  assert.equal(exceedsPinnedCharacterLimit("👍x", 1), true);
  assert.equal(exceedsPinnedCharacterLimit("一二三四五", null), false);
  assert.equal(contentErrors.PROFILE_LIMIT_EXCEEDED, 409);
  assert.equal(contentErrors.PROFILE_VERSION_REQUIRED, 422);
  assert.equal(contentErrors.PROFILE_PIN_LOCKED, 409);
  assert.equal(contentErrors.NOT_FOUND, 404);
  assert.equal(safeReturnTo("/dashboard/content/channel-profiles"), "/dashboard/content/channel-profiles");
  assert.equal(safeReturnTo("/dashboard/content/channel-profiles?brandId=1"), "/dashboard/content/channel-profiles?brandId=1");
  assert.equal(publishChannelProfileSchema.safeParse({
    brandId: randomUUID(),
    channelKey: "desk",
    maxCharacters: null,
    note: "  不设上限  ",
  }).success, true);
  assert.equal(publishChannelProfileSchema.safeParse({
    brandId: randomUUID(),
    channelKey: "desk",
    maxCharacters: 0,
    note: "零上限",
  }).success, false);
  const rules = readFileSync("src/features/channel-variants/rules.ts", "utf8");
  assert.equal(rules.includes("知乎"), false);
  assert.equal(rules.includes("公众号"), false);
  for (const locale of ["zh-CN", "en"]) {
    const messages = JSON.parse(readFileSync(`src/lib/i18n/messages/${locale}.json`, "utf8"));
    assert.equal(messages.channelProfiles.title.length > 0, true);
    assert.equal(JSON.stringify(messages.channelProfiles).includes("知乎"), false);
    assert.equal(JSON.stringify(messages.channelProfiles).includes("公众号"), false);
  }
});

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Profile owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function versionRow(db, id) {
  const [row] = await queryWithParameters(
    db,
    `SELECT id, channel_key AS "channelKey", max_characters AS "maxCharacters",
            note, version_number AS "versionNumber"
     FROM channel_profile_version WHERE id = ?`,
    [id],
  );
  return {
    id: row.id,
    channelKey: row.channelKey,
    maxCharacters: row.maxCharacters == null ? null : Number(row.maxCharacters),
    note: row.note,
    versionNumber: Number(row.versionNumber),
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: existing variants keep a null profile pin across the upgrade`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, profileBaselineTag(kind));
    await assert.rejects(() => queryWithParameters(db, "SELECT id FROM channel_profile", []));
    const owner = await account(db);
    const brand = randomUUID();
    const brief = randomUUID();
    const briefVersion = randomUUID();
    const batch = randomUUID();
    const unit = randomUUID();
    const version = randomUUID();
    const variant = randomUUID();
    await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
      VALUES (?, ?, 'active', 1, 1, ?)`, [brand, owner, time]);
    await queryWithParameters(db, `INSERT INTO content_brief (
      id, brand_id, owner_id, plan_id, optimization_task_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, 'confirmed', ?, ?)`, [brief, brand, owner, time, time]);
    await queryWithParameters(db, `INSERT INTO content_brief_version (
      id, brief_id, brand_id, revision, audience, target_gap, applicable_boundary, primary_page,
      conversion_action, template_kind, title_candidates_json, fact_version_ids_json, competitor_source, confirmed_at, created_at
    ) VALUES (?, ?, ?, 1, '采购', '口径', '公开页', 'https://ji.example.com', '预约', 'fact_faq', '["标题"]', '[]', NULL, ?, ?)`, [
      briefVersion, brief, brand, time, time,
    ]);
    await queryWithParameters(db, `INSERT INTO content_batch (
      id, brand_id, owner_id, status, reservation_id, operation_id, cost_ledger_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'completed', NULL, ?, '{}', ?, ?)`, [batch, brand, owner, randomUUID(), time, time]);
    await queryWithParameters(db, `INSERT INTO content_batch_unit (
      id, batch_id, brief_id, brand_id, status, attempt_count, content_version_id, last_error, blocked_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'succeeded', 1, NULL, NULL, NULL, ?, ?)`, [unit, batch, brief, brand, time, time]);
    await queryWithParameters(db, `INSERT INTO content_version (
      id, brand_id, owner_id, brief_id, brief_version_id, batch_unit_id, template_kind, title, body_markdown,
      claims_json, status, fingerprint, created_at, target_channel, labeling_profile_version, labeling_profile_status,
      image_asset_ids_json, fact_version_ids_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'fact_faq', '旧稿', '旧正文', '[]', 'approved', 'fingerprint-old', ?, 'primary_page', 'unverified', 'unverified', '[]', '[]', ?)`, [
      version, brand, owner, brief, briefVersion, unit, time, time,
    ]);
    await queryWithParameters(db, `INSERT INTO content_channel_variant (
      id, brand_id, owner_id, content_version_id, channel, body_markdown, approval_status, approval_id,
      needs_own_approval, blocked, fingerprint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'legacy', '旧变体', 'draft', NULL, 1, 0, 'fingerprint-variant', ?, ?)`, [
      variant, brand, owner, version, time, time,
    ]);
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [row] = await queryWithParameters(
      db,
      `SELECT body_markdown AS "bodyMarkdown", channel_profile_version_id AS "channelProfileVersionId"
       FROM content_channel_variant WHERE id = ?`,
      [variant],
    );
    assert.equal(row.bodyMarkdown, "旧变体");
    assert.equal(row.channelProfileVersionId, null);
    const [profiles] = await queryWithParameters(db, "SELECT count(*) AS n FROM channel_profile", []);
    assert.equal(Number(profiles.n), 0);
  });

  test(`${kind}: a pinned limit stays on the old version and blocks only that export`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(async () => fixture.cleanup());
    const ddl = await testDatabase(kind, { ddl: true });
    t.after(async () => ddl.cleanup());
    const db = fixture.connection;
    assert.deepEqual(await structure(db), await structure(ddl.connection));
    const [owner, outsider] = await Promise.all([account(db), account(db)]);
    const brand = randomUUID();
    await new BrandDao(db).insertBrand(owner, brand, time);
    await new BrandDao(db).insertVersion(brand, 1, brandFields, time);
    const packageOptions = { env: storageEnv, storage: memoryStorage(), now: new Date(time) };

    const first = await publishChannelProfile(db, owner, {
      brandId: brand,
      channelKey: "desk",
      maxCharacters: 4,
      note: "四字以内",
    }, () => time);
    assert.equal(first.error, undefined);
    assert.equal(first.version.versionNumber, 1);
    const storedFirst = await versionRow(db, first.version.id);
    const watched = watch(db);
    const second = await publishChannelProfile(watched.connection, owner, {
      brandId: brand,
      channelKey: "desk",
      maxCharacters: 100000,
      note: "放宽上限",
    }, () => later);
    assert.equal(second.error, undefined);
    assert.equal(second.version.versionNumber, 2);
    assert.equal(watched.captured.some((item) => /UPDATE\s+channel_profile_version/i.test(item.sql)), false);
    assert.equal(watched.captured.filter((item) => /INSERT INTO channel_profile_version/i.test(item.sql)).length, 1);
    assert.equal(watched.captured.filter((item) => /INSERT INTO channel_profile\b/i.test(item.sql)).length, 0);
    assert.deepEqual(await versionRow(db, first.version.id), storedFirst);

    const hidden = await listChannelProfiles(db, outsider, brand);
    assert.deepEqual(hidden, { error: "NOT_FOUND" });
    const hiddenWrite = await publishChannelProfile(db, outsider, {
      brandId: brand,
      channelKey: "desk",
      maxCharacters: 9,
      note: "别人的上限",
    }, () => later);
    assert.deepEqual(hiddenWrite, { error: "NOT_FOUND" });
    const [profileCount] = await queryWithParameters(db, "SELECT count(*) AS n FROM channel_profile WHERE brand_id = ?", [brand]);
    assert.equal(Number(profileCount.n), 1);

    await assert.rejects(
      () => queryWithParameters(db, `INSERT INTO channel_profile_version (
        id, profile_id, brand_id, owner_id, channel_key, max_characters, note, version_number, created_at
      ) VALUES (?, ?, ?, ?, 'desk', 0, '零', 9, ?)`, [randomUUID(), first.version.profileId, brand, owner, time]),
      /CHECK|check constraint/i,
    );
    await assert.rejects(
      () => queryWithParameters(db, `UPDATE channel_profile_version SET max_characters = 0 WHERE id = ?`, [first.version.id]),
      /CHECK|check constraint/i,
    );

    const noise = Array.from({ length: 200 }, () => randomUUID());
    await queryWithParameters(
      db,
      `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
       VALUES ${noise.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`,
      noise.flatMap((id) => [id, outsider, time]),
    );
    await queryWithParameters(
      db,
      `INSERT INTO channel_profile (id, brand_id, owner_id, channel_key, created_at, updated_at)
       VALUES ${noise.map(() => "(?, ?, ?, 'noise', ?, ?)").join(", ")}`,
      noise.flatMap((id) => [id, id, outsider, time, time]),
    );
    await queryWithParameters(
      db,
      `INSERT INTO channel_profile_version (
        id, profile_id, brand_id, owner_id, channel_key, max_characters, note, version_number, created_at
      ) VALUES ${noise.map(() => "(?, ?, ?, ?, 'noise', 20, '规模说明', 1, ?)").join(", ")}`,
      noise.flatMap((id) => [randomUUID(), id, id, outsider, time]),
    );
    if (db.kind === "postgresql") await db.query("ANALYZE channel_profile_version");
    const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
    const planQuery = channelProfileVersionListQuery(owner, brand);
    const plan = JSON.stringify(await queryWithParameters(db, explain + planQuery.sql, planQuery.values));
    assert.match(plan, /channel_profile_version_owner_idx/);
    const listed = await listChannelProfiles(db, owner, brand);
    assert.equal(listed.error, undefined);
    assert.deepEqual(listed.versions.map((item) => item.versionNumber), [2, 1]);

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
          primaryPage: "https://ji.example.com/pricing",
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
      return { versionId, body: detail.version.bodyMarkdown };
    }

    const countPackages = async () => {
      const [row] = await queryWithParameters(db, "SELECT count(*) AS n FROM content_delivery_package WHERE brand_id = ?", [brand]);
      return Number(row.n);
    };
    const packagesBefore = await countPackages();
    const { versionId } = await approvedVersion();
    const missing = await saveChannelVariant(db, owner, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "desk",
      bodyMarkdown: "一二三",
    }, clock);
    assert.equal(missing.error, "PROFILE_VERSION_REQUIRED");
    const [missingRows] = await queryWithParameters(
      db,
      "SELECT count(*) AS n FROM content_channel_variant WHERE content_version_id = ?",
      [versionId],
    );
    assert.equal(Number(missingRows.n), 0);

    const saved = await saveChannelVariant(db, owner, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "desk",
      bodyMarkdown: "一二三四五",
      profileVersionId: first.version.id,
    }, clock);
    assert.equal(saved.error, undefined);
    assert.equal(saved.variant.profileVersionNumber, 1);
    assert.equal(saved.variant.profileMaxCharacters, 4);
    const mismatched = await saveChannelVariant(db, owner, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "booth",
      bodyMarkdown: "一二三四五",
      profileVersionId: first.version.id,
    }, clock);
    assert.equal(mismatched.error, "PROFILE_VERSION_REQUIRED");
    const locked = await saveChannelVariant(db, owner, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "desk",
      bodyMarkdown: "一二三四五",
      profileVersionId: second.version.id,
    }, clock);
    assert.equal(locked.error, "PROFILE_PIN_LOCKED");
    const [pin] = await queryWithParameters(
      db,
      `SELECT channel_profile_version_id AS "channelProfileVersionId" FROM content_channel_variant WHERE id = ?`,
      [saved.variant.id],
    );
    assert.equal(pin.channelProfileVersionId, first.version.id);

    const exported = await exportChannelVariant(db, owner, {
      action: "export-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "desk",
    }, clock, packageOptions);
    assert.equal(exported.error, "PROFILE_LIMIT_EXCEEDED");
    assert.equal(contentErrors[exported.error], 409);
    assert.equal(await countPackages(), packagesBefore);
    const exportedAgain = await exportChannelVariant(db, owner, {
      action: "export-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "desk",
    }, clock, packageOptions);
    assert.equal(exportedAgain.error, "PROFILE_LIMIT_EXCEEDED");
    assert.equal(await countPackages(), packagesBefore);
    const reread = await readChannelVariant(db, owner, saved.variant.id);
    assert.equal(reread.variant.profileVersionNumber, 1);
    assert.equal(reread.variant.profileMaxCharacters, 4);

    const nextMaster = await approvedVersion();
    assert.equal(characterCount(nextMaster.body) > 4, true);
    assert.equal(characterCount(nextMaster.body) <= 100000, true);
    const widened = await saveChannelVariant(db, owner, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId: nextMaster.versionId,
      channel: "desk",
      bodyMarkdown: nextMaster.body,
      profileVersionId: second.version.id,
    }, clock);
    assert.equal(widened.error, undefined);
    assert.equal(widened.variant.profileVersionNumber, 2);
    const approvedWide = await approveChannelVariant(db, owner, {
      action: "approve-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId: nextMaster.versionId,
      channel: "desk",
    }, clock);
    assert.equal(approvedWide.error, undefined);
    const wideExport = await exportChannelVariant(db, owner, {
      action: "export-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId: nextMaster.versionId,
      channel: "desk",
    }, clock, packageOptions);
    assert.equal(wideExport.error, undefined);
    assert.equal(await countPackages(), packagesBefore + 1);
    const oldExport = await exportChannelVariant(db, owner, {
      action: "export-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "desk",
    }, clock, packageOptions);
    assert.equal(oldExport.error, "PROFILE_LIMIT_EXCEEDED");
    assert.equal(await countPackages(), packagesBefore + 1);

    const open = await publishChannelProfile(db, owner, {
      brandId: brand,
      channelKey: "open_note",
      maxCharacters: null,
      note: "这个版本不限制字数",
    }, () => later);
    assert.equal(open.error, undefined);
    const openSaved = await saveChannelVariant(db, owner, {
      action: "save-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "open_note",
      bodyMarkdown: (await readContentVersion(db, owner, versionId)).version.bodyMarkdown,
      profileVersionId: open.version.id,
    }, clock);
    assert.equal(openSaved.error, undefined);
    assert.equal(openSaved.variant.profileMaxCharacters, null);
    const openApproved = await approveChannelVariant(db, owner, {
      action: "approve-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "open_note",
    }, clock);
    assert.equal(openApproved.error, undefined);
    const openExport = await exportChannelVariant(db, owner, {
      action: "export-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "open_note",
    }, clock, packageOptions);
    assert.equal(openExport.error, undefined);
    await queryWithParameters(
      db,
      "UPDATE content_channel_variant SET channel_profile_version_id = NULL WHERE id = ?",
      [openSaved.variant.id],
    );
    const unpinned = await exportChannelVariant(db, owner, {
      action: "export-channel-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      channel: "open_note",
    }, clock, packageOptions);
    assert.equal(unpinned.error, undefined);
    const [unpinnedRow] = await queryWithParameters(
      db,
      `SELECT channel_profile_version_id AS "channelProfileVersionId" FROM content_channel_variant WHERE id = ?`,
      [openSaved.variant.id],
    );
    assert.equal(unpinnedRow.channelProfileVersionId, null);
    assert.equal(await countPackages(), packagesBefore + 3);
  });
}
