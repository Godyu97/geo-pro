import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  exportConfirm,
  exportPreflight,
  generateBatch,
  readContentAssetBytes,
  readDeliveryPackage,
  registerAsset,
  saveBriefDraft,
  confirmBrief,
  updateVariant,
  submitReview,
  approveContent,
} from "../../src/features/content/commands.ts";
import { buildPackageFiles } from "../../src/features/content/package.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-21T08:00:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const storageEnv = {
  S3_ENDPOINT: "http://127.0.0.1:9",
  S3_REGION: "us-east-1",
  S3_BUCKET: "app-files",
  S3_ACCESS_KEY_ID: "local-app",
  S3_SECRET_ACCESS_KEY: "s3-secret-not-for-logs",
  S3_FORCE_PATH_STYLE: "true",
};
const brandFields = {
  name: "戊品牌",
  description: "Synthetic brand for asset objects",
  website: "https://wu.example.com",
  aliases: ["戊"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(
    kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json",
    "utf8",
  ));
  const target = kind === "sqlite" ? "0016_content_approval_export" : "0017_content_approval_export";
  const index = journal.entries.findIndex((entry) => entry.tag === target);
  if (index <= 0) throw new Error(`missing migration ${target}`);
  return journal.entries[index - 1].tag;
}

function memoryStorage() {
  const objects = new Map();
  const calls = { put: 0, get: 0 };
  return {
    calls,
    async putAndReadBack({ key, body, contentType }) {
      calls.put += 1;
      const sha256 = createHash("sha256").update(body).digest("hex");
      objects.set(key, body);
      return { ok: true, status: "ready", bucket: "app-files", key, byteSize: body.byteLength, sha256, contentType };
    },
    async getObject({ key }) {
      calls.get += 1;
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

function trace(connection) {
  const queries = [];
  const wrap = (current) => ({
    kind: current.kind,
    query(sql, values) {
      queries.push(sql);
      return current.query(sql, values);
    },
    transaction(work) {
      return current.transaction((tx) => work(wrap(tx)));
    },
    savepoint(work) {
      return current.savepoint((nested) => work(wrap(nested)));
    },
    close() {
      return current.close();
    },
  });
  return { connection: wrap(connection), queries };
}

async function explain(connection, sql, values) {
  const prefix = connection.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
  if (connection.kind === "postgresql") {
    await connection.query("ANALYZE content_asset");
    return connection.transaction(async (tx) => {
      await tx.query("SET LOCAL enable_seqscan = off");
      return queryWithParameters(tx, prefix + sql, values);
    });
  }
  return queryWithParameters(connection, prefix + sql, values);
}

test("messages: asset object errors exist in zh-CN and en", () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  for (const key of ["ASSET_TYPE_REJECTED", "ASSET_TOO_LARGE", "ASSET_UNREVIEWED"]) {
    assert.match(zhCN.content[key], /JPEG|10 MiB|审核/);
    assert.match(en.content[key], /JPEG|10 MiB|approved/);
    assert.equal(zhCN.content[key].includes("127.0.0.1"), false);
    assert.equal(en.content[key].includes("v1/"), false);
  }
});

test("pure: formal package omits internal object metadata", () => {
  const internalKey = "v1/owner/brand/internal-material/object-secret/secret.png";
  const built = buildPackageFiles({
    kind: "formal",
    approvalId: "approval-1",
    contentFingerprint: "fp",
    version: {
      id: "v1",
      title: "T",
      bodyMarkdown: "public body",
      targetChannel: "primary_page",
      labelingProfileVersion: "p1",
      labelingProfileStatus: "verified",
      factVersionIds: ["f1"],
    },
    facts: [],
    assets: [
      {
        id: "public",
        kind: "cover",
        source: "Studio",
        rightsStatement: "Owned",
        visibility: "public",
        reviewStatus: "approved",
        contentRef: "ref://public",
        fingerprint: "pub",
        linkedObject: true,
        stored: {
          id: "object-public",
          class: "authorized-media",
          visibility: "public",
          status: "ready",
          contentType: "image/jpeg",
          byteSize: 4,
          sha256: "a".repeat(64),
          fileName: "cover.jpg",
        },
      },
      {
        id: "secret",
        kind: "inline",
        source: "SECRET-SOURCE",
        rightsStatement: "SECRET-RIGHTS",
        visibility: "internal",
        reviewStatus: "approved",
        contentRef: internalKey,
        fingerprint: "sec",
        linkedObject: true,
        stored: {
          id: "object-secret",
          class: "internal-material",
          visibility: "internal",
          status: "ready",
          contentType: "image/png",
          byteSize: 4,
          sha256: "b".repeat(64),
          fileName: "secret.png",
        },
      },
      {
        id: "pending",
        kind: "inline",
        source: "Pending studio",
        rightsStatement: "Owned",
        visibility: "public",
        reviewStatus: "pending",
        contentRef: "ref://PENDING",
        fingerprint: "pend",
        linkedObject: true,
        stored: {
          id: "object-pending",
          class: "authorized-media",
          visibility: "public",
          status: "ready",
          contentType: "image/webp",
          byteSize: 4,
          sha256: "c".repeat(64),
          fileName: "pending.webp",
        },
      },
    ],
  });
  const blob = Object.values(built.files).join("\n");
  assert.equal(blob.includes(internalKey), false);
  assert.equal(blob.includes("object-secret"), false);
  assert.equal(blob.includes("SECRET"), false);
  assert.equal(blob.includes("object-pending"), false);
  assert.equal(blob.includes("ref://PENDING"), false);
  assert.match(built.files["public-images.json"], /object-public/);
  assert.match(built.files["public-images.json"], /cover\.jpg/);
  assert.equal(JSON.parse(built.files["manifest.json"]).imageCount, 1);
  assert.equal(JSON.parse(built.files["manifest.json"]).excludedAssetCount, 2);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: OSS-AC-04 stores images and keeps internal bytes out of the formal package`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const storage = memoryStorage();
    const options = { env: storageEnv, storage, now: new Date(time) };

    const account = async (name) => {
      const id = randomUUID();
      await queryWithParameters(
        db,
        'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
        [id, name, `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
      );
      return id;
    };
    const owner = await account("Asset owner");
    const outsider = await account("Asset outsider");
    const brands = new BrandDao(db);
    const newBrand = async (ownerId) => {
      const id = randomUUID();
      await brands.insertBrand(ownerId, id, time);
      await brands.insertVersion(id, 1, brandFields, time);
      return id;
    };
    const brand = await newBrand(owner);
    const outsiderBrand = await newBrand(outsider);
    const countObjects = async (status) => {
      const filter = status ? "brand_id = ? AND status = ?" : "brand_id = ?";
      const values = status ? [brand, status] : [brand];
      const [row] = await queryWithParameters(db, `SELECT count(*) AS n FROM stored_object WHERE ${filter}`, values);
      return Number(row.n);
    };
    const register = (patch, file) => registerAsset(db, owner, {
      action: "register-asset",
      brandId: brand,
      operationId: randomUUID(),
      kind: "cover",
      source: "Public studio",
      rightsStatement: "Owned by the brand",
      visibility: "public",
      reviewStatus: "approved",
      contentRef: "ref://public-cover",
      ...patch,
    }, clock, file ? { ...options, file } : {});

    const tooBig = await register(
      { contentRef: "ref://too-big" },
      { fileName: "big.jpg", contentType: "image/jpeg", body: new Uint8Array(10 * 1024 * 1024 + 1) },
    );
    assert.equal(tooBig.error, "ASSET_TOO_LARGE");
    const wrongType = await register(
      { contentRef: "ref://gif" },
      { fileName: "anim.gif", contentType: "image/gif", body: jpeg },
    );
    assert.equal(wrongType.error, "ASSET_TYPE_REJECTED");
    const missingRights = await register(
      { rightsStatement: " ", contentRef: "ref://no-rights" },
      { fileName: "cover.jpg", contentType: "image/jpeg", body: jpeg },
    );
    assert.equal(missingRights.error, "INVALID_INPUT");
    assert.equal(storage.calls.put, 0);
    assert.equal(await countObjects(), 0);
    assert.equal(await countObjects("ready"), 0);

    const historical = await register({ contentRef: "ref://historical-only", kind: "inline" });
    assert.equal(historical.error, undefined);
    assert.equal(historical.asset.storedObjectId, null);
    assert.equal(historical.asset.contentRef, "ref://historical-only");

    const publicAsset = await register(
      { contentRef: "ref://public-cover", kind: "cover" },
      { fileName: "cover.jpg", contentType: "image/jpeg", body: jpeg },
    );
    const internalAsset = await register({
      visibility: "internal",
      kind: "inline",
      source: "INTERNAL-SOURCE-LABEL",
      rightsStatement: "INTERNAL-RIGHTS-NOTE",
      contentRef: "ref://INTERNAL-ATTACHMENT",
    }, { fileName: "secret.png", contentType: "image/png", body: png });
    const pendingAsset = await register(
      { reviewStatus: "pending", contentRef: "ref://PENDING-IMAGE", kind: "inline" },
      { fileName: "pending.jpg", contentType: "image/jpeg", body: jpeg },
    );
    assert.equal(publicAsset.error, undefined);
    assert.equal(internalAsset.error, undefined);
    assert.equal(pendingAsset.error, undefined);
    assert.equal(internalAsset.asset.visibility, "internal");
    assert.equal(storage.calls.put, 3);
    assert.equal(await countObjects("ready"), 3);

    const [internalObject] = await queryWithParameters(
      db,
      `SELECT "class" AS "class", visibility, status, object_key AS "objectKey"
       FROM stored_object WHERE id = ? AND brand_id = ?`,
      [internalAsset.asset.storedObjectId, brand],
    );
    const [publicObject] = await queryWithParameters(
      db,
      `SELECT "class" AS "class", visibility, status, object_key AS "objectKey"
       FROM stored_object WHERE id = ? AND brand_id = ?`,
      [publicAsset.asset.storedObjectId, brand],
    );
    assert.equal(internalObject.class, "internal-material");
    assert.equal(internalObject.visibility, "internal");
    assert.equal(internalObject.status, "ready");
    assert.equal(publicObject.class, "authorized-media");
    assert.equal(publicObject.visibility, "public");
    assert.match(internalObject.objectKey, /\/internal-material\//);
    assert.equal(publicObject.objectKey.includes("internal-material"), false);

    const factId = randomUUID();
    const fact = {
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
    const runFact = (command) => executeFactCommand(db, { ownerId: owner, brandId: brand }, command, factClock);
    assert.deepEqual(await runFact({ action: "create", id: factId, previousId: null, fields: fact }), { id: factId });
    assert.deepEqual(await runFact({ action: "submit", id: factId, revision: 1 }), { id: factId });
    assert.deepEqual(await runFact({
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
    const confirmed = await confirmBrief(db, owner, {
      action: "confirm-brief", brandId: brand, briefId: saved.briefId, operationId: randomUUID(),
    }, clock);
    assert.equal(saved.error, undefined);
    assert.equal(confirmed.error, undefined);
    const batch = await generateBatch(db, owner, {
      action: "generate-batch", brandId: brand, operationId: randomUUID(), briefIds: [saved.briefId],
    }, clock);
    assert.equal(batch.error, undefined);
    const versionId = batch.units[0].contentVersionId;
    const edited = await updateVariant(db, owner, {
      action: "update-variant",
      brandId: brand,
      operationId: randomUUID(),
      versionId,
      bodyMarkdown: "Public body for the formal package",
      imageAssetIds: [publicAsset.asset.id, internalAsset.asset.id, pendingAsset.asset.id],
      labelingProfileVersion: "profile-2026-11",
      labelingProfileStatus: "verified",
    }, clock);
    assert.equal(edited.error, undefined);
    assert.equal((await submitReview(db, owner, {
      action: "submit-review", brandId: brand, operationId: randomUUID(), versionId,
    }, clock)).status, "in_review");
    assert.equal((await approveContent(db, owner, {
      action: "approve-content", brandId: brand, operationId: randomUUID(), versionId,
    }, clock)).error, undefined);

    const operationId = randomUUID();
    const traced = trace(db);
    const preflight = await exportPreflight(db, owner, {
      action: "export-preflight", brandId: brand, operationId, versionIds: [versionId], mode: "formal",
    }, clock);
    assert.deepEqual(preflight.eligibleVersionIds, [versionId]);
    const exported = await exportConfirm(traced.connection, owner, {
      action: "export-confirm", brandId: brand, operationId, chosenVersionIds: [versionId],
    }, clock, options);
    assert.equal(exported.error, undefined);
    const objectSelects = traced.queries.filter((sql) => sql.includes("FROM stored_object") && sql.includes(" IN "));
    assert.equal(objectSelects.length, 1);
    assert.equal(storage.calls.get, 0);

    const read = await readDeliveryPackage(db, owner, exported.packages[0].id, options);
    const blob = Object.values(read.files).join("\n");
    assert.equal(blob.includes(internalObject.objectKey), false);
    assert.equal(blob.includes(internalAsset.asset.storedObjectId), false);
    assert.equal(blob.includes("INTERNAL-"), false);
    assert.equal(blob.includes("ref://INTERNAL"), false);
    assert.equal(blob.includes("ref://PENDING"), false);
    assert.equal(blob.includes(pendingAsset.asset.storedObjectId), false);
    assert.match(blob, /ref:\/\/public-cover/);
    assert.match(blob, new RegExp(publicAsset.asset.storedObjectId));
    assert.match(read.files["content.md"], /Public body/);
    const manifest = JSON.parse(read.files["manifest.json"]);
    assert.equal(manifest.imageCount, 1);
    assert.equal(manifest.excludedAssetCount, 2);
    assert.equal(manifest.packageKind, "formal");
    const packageReads = storage.calls.get;

    const knownId = internalAsset.asset.storedObjectId;
    for (const [actor, scope] of [[outsider, outsiderBrand], [outsider, brand]]) {
      const denied = await readContentAssetBytes(db, actor, { brandId: scope, objectId: knownId }, options);
      assert.equal(denied.error, "NOT_FOUND");
      assert.equal("body" in denied, false);
    }
    assert.equal(storage.calls.get, packageReads);
    const unreviewed = await readContentAssetBytes(
      db, owner, { brandId: brand, objectId: pendingAsset.asset.storedObjectId }, options,
    );
    assert.equal(unreviewed.error, "ASSET_UNREVIEWED");
    assert.equal("body" in unreviewed, false);
    assert.equal(storage.calls.get, packageReads);
    const opened = await readContentAssetBytes(
      db, owner, { brandId: brand, objectId: publicAsset.asset.storedObjectId }, options,
    );
    assert.equal(opened.error, undefined);
    assert.deepEqual(opened.body, jpeg);
    assert.equal(opened.fileName, "cover.jpg");
    assert.equal("objectKey" in opened, false);

    const planSql = `SELECT id FROM content_asset
      WHERE stored_object_id = ? AND owner_id = ? AND brand_id = ?
      LIMIT 1`;
    const plan = JSON.stringify(await explain(db, planSql, [knownId, owner, brand]));
    assert.match(plan, /content_asset_object_uidx/);
    console.log(JSON.stringify({
      event: "content-asset-object-plan",
      kind,
      objectSelects: objectSelects.length,
      index: plan.includes("content_asset_object_uidx"),
    }));
  });
}
