import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  approveContent,
  confirmBrief,
  exportConfirm,
  exportPreflight,
  generateBatch,
  readDeliveryPackage,
  registerAsset,
  saveBriefDraft,
  submitReview,
  updateVariant,
} from "../../src/features/content/commands.ts";
import {
  buildPackageFiles,
  inlinePackageFiles,
  packageContentType,
  resealPackageManifest,
  storedPackageIndex,
} from "../../src/features/content/package.ts";
import { saveStoredObject } from "../../src/features/stored-objects/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-21T09:00:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const replacement = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
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
  description: "Synthetic brand for delivery objects",
  website: "https://ji.example.com",
  aliases: ["己"],
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
    objects,
    calls,
    async putAndReadBack({ key, body, contentType }) {
      calls.put += 1;
      const copy = Uint8Array.from(body);
      const sha256 = createHash("sha256").update(copy).digest("hex");
      objects.set(key, copy);
      return { ok: true, status: "ready", bucket: "app-files", key, byteSize: copy.byteLength, sha256, contentType };
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

function failingStorage() {
  return {
    async putAndReadBack() {
      return { ok: false, status: "failed", code: "unavailable" };
    },
    async getObject() {
      throw new Error("historical download must not touch the bucket");
    },
    async deleteObject() {
      return { ok: true };
    },
    async presignGet() {
      return { ok: false, status: "failed", code: "unavailable" };
    },
  };
}

function snapshot(storage) {
  return new Map([...storage.objects.entries()].map(([key, body]) => [key, Uint8Array.from(body)]));
}

function unchanged(storage, before) {
  for (const [key, body] of before) {
    assert.deepEqual(storage.objects.get(key), body);
  }
}

function sha256Text(value) {
  return createHash("sha256").update(new TextEncoder().encode(value)).digest("hex");
}

test("messages: package storage failure is bilingual and has a next step", () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  assert.match(zhCN.content.SERVICE_UNAVAILABLE, /保存或读取/);
  assert.match(zhCN.content.SERVICE_UNAVAILABLE, /重试/);
  assert.match(en.content.SERVICE_UNAVAILABLE, /saved or read/i);
  assert.match(en.content.SERVICE_UNAVAILABLE, /try again/i);
  assert.equal(zhCN.content.SERVICE_UNAVAILABLE.includes("127.0.0.1"), false);
  assert.equal(en.content.SERVICE_UNAVAILABLE.includes("v1/"), false);
});

test("pure: object manifest records fingerprints and inline files stay inline", () => {
  const built = buildPackageFiles({
    kind: "review",
    approvalId: null,
    contentFingerprint: "fp",
    version: {
      id: "v1",
      title: "T",
      bodyMarkdown: "公开正文",
      targetChannel: "primary_page",
      labelingProfileVersion: "p1",
      labelingProfileStatus: "unverified",
      factVersionIds: [],
    },
    facts: [],
    assets: [],
  });
  const stored = built.manifest.files.map((file, index) => ({
    objectId: `00000000-0000-4000-8000-00000000000${index + 1}`,
    name: file.name,
    contentType: packageContentType(file.name),
    byteSize: new TextEncoder().encode(built.files[file.name]).byteLength,
    sha256: file.sha256,
  }));
  const sealed = resealPackageManifest(built, stored);
  assert.ok(sealed);
  const manifest = JSON.parse(sealed.files["manifest.json"]);
  assert.equal(manifest.nonPublishable, true);
  assert.equal(manifest.files.length, stored.length);
  assert.equal(manifest.files[0].objectId, stored[0].objectId);
  assert.equal(manifest.files[0].byteSize, stored[0].byteSize);
  assert.equal(manifest.files[0].sha256, sha256Text(built.files[manifest.files[0].name]));
  assert.equal(sealed.files["manifest.json"].includes("objectId"), true);
  assert.notEqual(sealed.packageFingerprint, built.packageFingerprint);
  assert.deepEqual(inlinePackageFiles(built.files)["content.md"], built.files["content.md"]);
  assert.equal(inlinePackageFiles({ version: 1, files: stored }), undefined);
  assert.equal(storedPackageIndex(built.files), undefined);
  const index = storedPackageIndex({ version: 1, files: [...stored, {
    objectId: "00000000-0000-4000-8000-000000000099",
    name: "manifest.json",
    contentType: "application/json",
    byteSize: 12,
    sha256: "a".repeat(64),
  }] });
  assert.equal(index.files.at(-1).name, "manifest.json");
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: delivery files are immutable objects and historical inline bytes stay in the row`, async (t) => {
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
    const owner = await account("Delivery owner");
    const outsider = await account("Delivery outsider");
    const brandId = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brandId, time);
    await brands.insertVersion(brandId, 1, brandFields, time);
    const factId = randomUUID();
    const fact = {
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
    const runFact = (command) => executeFactCommand(db, { ownerId: owner, brandId: brandId }, command, factClock);
    assert.deepEqual(await runFact({ action: "create", id: factId, previousId: null, fields: fact }), { id: factId });
    assert.deepEqual(await runFact({ action: "submit", id: factId, revision: 1 }), { id: factId });
    assert.deepEqual(await runFact({
      action: "approve", id: factId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
    }), { id: factId });
    const saved = await saveBriefDraft(db, owner, {
      action: "save-brief-draft",
      brandId: brandId,
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
    const confirmed = await confirmBrief(db, owner, {
      action: "confirm-brief", brandId: brandId, briefId: saved.briefId, operationId: randomUUID(),
    }, clock);
    assert.equal(saved.error, undefined);
    assert.equal(confirmed.error, undefined);
    const batch = await generateBatch(db, owner, {
      action: "generate-batch", brandId: brandId, operationId: randomUUID(), briefIds: [saved.briefId],
    }, clock);
    assert.equal(batch.error, undefined);
    const versionId = batch.units[0].contentVersionId;
    const register = (contentRef, fileName, body) => registerAsset(db, owner, {
      action: "register-asset",
      brandId: brandId,
      operationId: randomUUID(),
      kind: "cover",
      source: "Public studio",
      rightsStatement: "Owned by the brand",
      visibility: "public",
      reviewStatus: "approved",
      contentRef,
    }, clock, { ...options, file: { fileName, contentType: "image/jpeg", body } });
    const firstImage = await register("ref://cover-a", "cover-a.jpg", jpeg);
    const secondImage = await register("ref://cover-b", "cover-b.jpg", replacement);
    assert.equal(firstImage.error, undefined);
    assert.equal(secondImage.error, undefined);

    const edited = await updateVariant(db, owner, {
      action: "update-variant",
      brandId: brandId,
      operationId: randomUUID(),
      versionId,
      title: "Original title",
      bodyMarkdown: "Public body for the immutable package",
      imageAssetIds: [firstImage.asset.id],
      labelingProfileVersion: "profile-2026-11",
      labelingProfileStatus: "verified",
    }, clock);
    assert.equal(edited.error, undefined);
    assert.equal((await submitReview(db, owner, {
      action: "submit-review", brandId: brandId, operationId: randomUUID(), versionId,
    }, clock)).status, "in_review");
    assert.equal((await approveContent(db, owner, {
      action: "approve-content", brandId: brandId, operationId: randomUUID(), versionId,
    }, clock)).error, undefined);

    const exportOnce = async () => {
      const operationId = randomUUID();
      const preflight = await exportPreflight(db, owner, {
        action: "export-preflight", brandId: brandId, operationId, versionIds: [versionId], mode: "formal",
      }, clock);
      assert.deepEqual(preflight.eligibleVersionIds, [versionId]);
      return exportConfirm(db, owner, {
        action: "export-confirm", brandId: brandId, operationId, chosenVersionIds: [versionId],
      }, clock, options);
    };
    const reapprove = async (patch) => {
      assert.equal((await updateVariant(db, owner, {
        action: "update-variant", brandId: brandId, operationId: randomUUID(), versionId, ...patch,
      }, clock)).invalidated, true);
      assert.equal((await submitReview(db, owner, {
        action: "submit-review", brandId: brandId, operationId: randomUUID(), versionId,
      }, clock)).status, "in_review");
      assert.equal((await approveContent(db, owner, {
        action: "approve-content", brandId: brandId, operationId: randomUUID(), versionId,
      }, clock)).error, undefined);
    };

    const first = await exportOnce();
    assert.equal(first.error, undefined);
    const firstId = first.packages[0].id;
    const [storedRow] = await queryWithParameters(
      db,
      `SELECT files_json AS "filesJson", non_publishable AS "nonPublishable" FROM content_delivery_package WHERE id = ?`,
      [firstId],
    );
    assert.equal(storedRow.filesJson.includes("Public body"), false);
    assert.equal(storedRow.filesJson.includes("objectKey"), false);
    const firstIndex = storedPackageIndex(JSON.parse(storedRow.filesJson));
    assert.ok(firstIndex);
    assert.ok(firstIndex.files.some((file) => file.name === "public-images.json"));
    assert.ok(firstIndex.files.some((file) => file.name === "manifest.json"));
    const [objectMeta] = await queryWithParameters(
      db,
      `SELECT "class" AS "class", visibility, immutable, status, object_key AS "objectKey"
       FROM stored_object WHERE id = ?`,
      [firstIndex.files[0].objectId],
    );
    assert.equal(objectMeta.class, "delivery-package");
    assert.equal(objectMeta.visibility, "internal");
    assert.equal(Number(objectMeta.immutable), 1);
    assert.equal(objectMeta.status, "ready");
    assert.match(objectMeta.objectKey, /\/delivery-package\//);

    const readFirst = await readDeliveryPackage(db, owner, firstId, options);
    assert.equal(readFirst.error, undefined);
    assert.match(readFirst.files["content.md"], /Public body for the immutable package/);
    const manifest = JSON.parse(readFirst.files["manifest.json"]);
    assert.equal(manifest.nonPublishable, false);
    assert.equal(manifest.packageKind, "formal");
    for (const file of manifest.files) {
      assert.equal(sha256Text(readFirst.files[file.name]), file.sha256);
      assert.equal(file.byteSize, new TextEncoder().encode(readFirst.files[file.name]).byteLength);
      assert.equal(typeof file.objectId, "string");
    }
    for (const file of firstIndex.files) {
      assert.equal(sha256Text(readFirst.files[file.name]), file.sha256);
    }
    const putsAfterFirst = storage.calls.put;
    const overwrite = await saveStoredObject(db, {
      actorId: owner,
      brandId: brandId,
      class: "delivery-package",
      visibility: "internal",
      fileName: firstIndex.files[0].name,
      contentType: firstIndex.files[0].contentType,
      objectId: firstIndex.files[0].objectId,
      body: new TextEncoder().encode("overwrite"),
    }, options);
    assert.equal(overwrite.ok, false);
    assert.equal(overwrite.code, "immutable");
    assert.equal(storage.calls.put, putsAfterFirst);

    const firstBytes = snapshot(storage);
    const firstFingerprint = manifest.contentFingerprint;
    await reapprove({ title: "Retitled package", bodyMarkdown: "Retitled public body" });
    const second = await exportOnce();
    assert.equal(second.error, undefined);
    const secondId = second.packages[0].id;
    assert.notEqual(secondId, firstId);
    const [secondRow] = await queryWithParameters(
      db,
      `SELECT files_json AS "filesJson" FROM content_delivery_package WHERE id = ?`,
      [secondId],
    );
    const secondIndex = storedPackageIndex(JSON.parse(secondRow.filesJson));
    const firstIds = new Set(firstIndex.files.map((file) => file.objectId));
    assert.ok(secondIndex.files.every((file) => !firstIds.has(file.objectId)));
    unchanged(storage, firstBytes);
    const addedAfterTitle = [...storage.objects.keys()].filter((key) => !firstBytes.has(key));
    assert.ok(addedAfterTitle.length >= 5);
    const rereadFirst = await readDeliveryPackage(db, owner, firstId, options);
    assert.match(rereadFirst.files["content.md"], /Public body for the immutable package/);
    assert.equal(rereadFirst.files["content.md"].includes("Retitled public body"), false);
    const readSecond = await readDeliveryPackage(db, owner, secondId, options);
    assert.match(readSecond.files["content.md"], /Retitled public body/);
    assert.notEqual(JSON.parse(readSecond.files["manifest.json"]).contentFingerprint, firstFingerprint);
    assert.match(readSecond.files["public-images.json"], new RegExp(firstImage.asset.storedObjectId));

    const afterTitle = snapshot(storage);
    await reapprove({ imageAssetIds: [secondImage.asset.id] });
    const third = await exportOnce();
    assert.equal(third.error, undefined);
    unchanged(storage, firstBytes);
    unchanged(storage, afterTitle);
    const readThird = await readDeliveryPackage(db, owner, third.packages[0].id, options);
    assert.match(readThird.files["public-images.json"], /ref:\/\/cover-b/);
    assert.equal(readThird.files["public-images.json"].includes("ref://cover-a"), false);
    assert.match(rereadFirst.files["public-images.json"], /ref:\/\/cover-a/);

    const reviewOp = randomUUID();
    const reviewPreflight = await exportPreflight(db, owner, {
      action: "export-preflight", brandId: brandId, operationId: reviewOp, versionIds: [versionId], mode: "review",
    }, clock);
    assert.equal(reviewPreflight.items[0].kind, "review");
    const review = await exportConfirm(db, owner, {
      action: "export-confirm", brandId: brandId, operationId: reviewOp, chosenVersionIds: [versionId],
    }, clock, options);
    assert.equal(review.error, undefined);
    assert.equal(review.packages[0].nonPublishable, true);
    const readReview = await readDeliveryPackage(db, owner, review.packages[0].id, options);
    assert.match(readReview.files["content.md"], /NON-PUBLISHABLE/);
    assert.match(readReview.files["content.md"], /非发布用/);
    assert.equal(JSON.parse(readReview.files["manifest.json"]).nonPublishable, true);
    const [publications] = await queryWithParameters(
      db,
      "SELECT count(*) AS n FROM content_publication WHERE brand_id = ?",
      [brandId],
    );
    assert.equal(Number(publications.n), 0);

    const beforeFailure = await queryWithParameters(
      db,
      "SELECT count(*) AS n FROM content_delivery_package WHERE brand_id = ?",
      [brandId],
    );
    const failOp = randomUUID();
    assert.equal((await exportPreflight(db, owner, {
      action: "export-preflight", brandId: brandId, operationId: failOp, versionIds: [versionId], mode: "review",
    }, clock)).error, undefined);
    const failed = await exportConfirm(db, owner, {
      action: "export-confirm", brandId: brandId, operationId: failOp, chosenVersionIds: [versionId],
    }, clock, { env: storageEnv, storage: failingStorage(), now: new Date(time) });
    assert.equal(failed.error, "SERVICE_UNAVAILABLE");
    const [afterFailure] = await queryWithParameters(
      db,
      "SELECT count(*) AS n FROM content_delivery_package WHERE brand_id = ?",
      [brandId],
    );
    assert.equal(Number(afterFailure.n), Number(beforeFailure[0].n));
    unchanged(storage, firstBytes);

    const historicalId = randomUUID();
    const historicalFiles = {
      "content.md": "# Historical inline\n",
      "content.html": "<p>Historical inline</p>\n",
      "manifest.json": "{\"packageKind\":\"review\",\"nonPublishable\":true}\n",
      "public-sources.json": "{\"sources\":[]}\n",
      "publish-checklist.md": "# Historical checklist\n",
    };
    await queryWithParameters(db, `INSERT INTO content_delivery_package (
      id, brand_id, owner_id, content_version_id, approval_id, target_channel, kind,
      content_fingerprint, fact_version_ids_json, labeling_profile_version,
      do_not_reuse, non_publishable, manifest_json, files_json, package_fingerprint, created_at
    ) VALUES (?, ?, ?, ?, NULL, 'primary_page', 'review', ?, '[]', 'historical', 0, 1, ?, ?, ?, ?)`, [
      historicalId, brandId, owner, versionId, "historical-fingerprint",
      "{\"packageKind\":\"review\",\"nonPublishable\":true}",
      JSON.stringify(historicalFiles),
      "c".repeat(64),
      time,
    ]);
    const getsBeforeHistorical = storage.calls.get;
    const historical = await readDeliveryPackage(db, owner, historicalId, {
      env: storageEnv,
      storage: failingStorage(),
      now: new Date(time),
    });
    assert.equal(historical.error, undefined);
    assert.equal(historical.files["content.md"], historicalFiles["content.md"]);
    assert.equal(storage.calls.get, getsBeforeHistorical);
    assert.equal((await readDeliveryPackage(db, outsider, firstId, {
      env: storageEnv, storage: failingStorage(), now: new Date(time),
    })).error, "NOT_FOUND");
  });
}
