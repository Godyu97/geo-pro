import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  approveContent,
  confirmBrief,
  generateBatch,
  readPublication,
  readPublicationEvidence,
  saveBriefDraft,
  submitManualEvidence,
  submitPublication,
  submitReview,
  updateVariant,
} from "../../src/features/content/commands.ts";
import { evaluatePublicCheck } from "../../src/features/content/verify.ts";
import { presignStoredObject, saveStoredObject } from "../../src/features/stored-objects/commands.ts";
import { MAX_STORED_OBJECT_BYTES } from "../../src/features/stored-objects/contracts.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-21T12:00:00.000Z";
const later = "2026-11-21T13:00:00.000Z";
const clock = () => time;
const laterClock = () => later;
const factClock = () => new Date(time);
const claimText = "Synthetic 100 CNY";
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
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
  description: "Synthetic brand for publication evidence",
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
  return journal.entries.at(-2).tag;
}

function digest(body) {
  return createHash("sha256").update(body).digest("hex");
}

function memoryStorage() {
  const objects = new Map();
  return {
    async putAndReadBack({ key, body, contentType }) {
      const copy = Uint8Array.from(body);
      objects.set(key, copy);
      return {
        ok: true,
        status: "ready",
        bucket: storageEnv.S3_BUCKET,
        key,
        byteSize: copy.byteLength,
        sha256: digest(copy),
        contentType,
      };
    },
    async getObject({ key }) {
      const body = objects.get(key);
      if (!body) return { ok: false, status: "failed", code: "unavailable" };
      return { ok: true, body, byteSize: body.byteLength, sha256: digest(body) };
    },
    async deleteObject({ key }) {
      objects.delete(key);
      return { ok: true };
    },
    async presignGet() {
      return { ok: false, status: "failed", code: "unavailable" };
    },
  };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Publication owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function approveFact(db, ownerId, brandId) {
  const id = randomUUID();
  const run = (command) => executeFactCommand(db, { ownerId, brandId }, command, factClock);
  assert.deepEqual(await run({ action: "create", id, previousId: null, fields: {
    ...emptyFields,
    category: "price",
    title: "Synthetic plan price",
    claim: claimText,
    sourceType: "url",
    sourceReference: "https://wu.example.com/pricing",
    sourceLocator: "Section 1",
    sourceExcerpt: "Public price excerpt",
    sourceDate: "2026-11-18",
    permission: "public",
    validity: "dated",
    validThrough: "2026-12-31",
  } }), { id });
  assert.deepEqual(await run({ action: "submit", id, revision: 1 }), { id });
  assert.deepEqual(await run({
    action: "approve", id, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
  }), { id });
  return id;
}

async function setup(t, kind) {
  const fixture = await testDatabase(kind, { migrateNow: false });
  t.after(() => fixture.cleanup());
  const db = fixture.connection;
  await migrateThrough(db, previousTag(kind));
  execFileSync("pnpm", ["db:migrate"], {
    env: { ...process.env, ...fixture.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [owner, outsider] = await Promise.all([account(db), account(db)]);
  const brandId = randomUUID();
  const brands = new BrandDao(db);
  await brands.insertBrand(owner, brandId, time);
  await brands.insertVersion(brandId, 1, brandFields, time);
  const factId = await approveFact(db, owner, brandId);
  const saved = await saveBriefDraft(db, owner, {
    action: "save-brief-draft",
    brandId,
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
  assert.equal((await confirmBrief(db, owner, {
    action: "confirm-brief", brandId, briefId: saved.briefId, operationId: randomUUID(),
  }, clock)).error, undefined);
  const batch = await generateBatch(db, owner, {
    action: "generate-batch", brandId, operationId: randomUUID(), briefIds: [saved.briefId],
  }, clock);
  assert.equal(batch.error, undefined);
  const versionId = batch.units[0].contentVersionId;
  await updateVariant(db, owner, {
    action: "update-variant",
    brandId,
    versionId,
    operationId: randomUUID(),
    labelingProfileStatus: "verified",
    labelingProfileVersion: "fixture-v1",
  }, clock);
  assert.equal((await submitReview(db, owner, {
    action: "submit-review", brandId, versionId, operationId: randomUUID(),
  }, clock)).error, undefined);
  assert.equal((await approveContent(db, owner, {
    action: "approve-content", brandId, versionId, operationId: randomUUID(),
  }, clock)).error, undefined);
  return { db, owner, outsider, brandId, versionId };
}

function evidenceInput(brandId, publicationId, fileName) {
  return {
    action: "submit-manual-evidence",
    brandId,
    operationId: randomUUID(),
    publicationId,
    screenshotRef: "https://storage.example/should-not-be-kept",
    pageMarker: "portal-page-9",
    observedAt: time,
    bodyExcerpt: `Visible claim ${claimText}`,
    reviewerNote: "Owner verified behind login",
    fileName,
  };
}

test("messages: screenshot errors exist in zh-CN and en", () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  for (const key of ["EVIDENCE_TYPE_REJECTED", "EVIDENCE_TOO_LARGE", "SCREENSHOT_REQUIRED", "screenshotFileHint"]) {
    assert.match(zhCN.content[key], /JPEG|10 MiB|verified_manual|截图/);
    assert.match(en.content[key], /JPEG|10 MiB|verified_manual|screenshot/i);
    assert.equal(zhCN.content[key].includes("127.0.0.1"), false);
    assert.equal(en.content[key].includes("v1/"), false);
  }
});

test("draft box and login wall stay unchanged", () => {
  const draft = evaluatePublicCheck({
    fixture: { accessClass: "draft_box", httpStatus: 200, title: "draft", bodyText: claimText },
    claims: [claimText],
    alreadyHasEffectiveAt: false,
  });
  assert.equal(draft.status, "draft_only");
  assert.equal(draft.setsEffectiveAt, false);
  assert.equal(draft.evidenceGrade, null);

  const login = evaluatePublicCheck({
    fixture: { accessClass: "login_wall", httpStatus: 401, title: "login", bodyText: "sign in" },
    claims: [claimText],
    alreadyHasEffectiveAt: false,
  });
  assert.equal(login.status, "access_limited");
  assert.equal(login.setsEffectiveAt, false);
  assert.equal(login.evidenceGrade, null);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: manual screenshot is a private immutable object`, async (t) => {
    const ctx = await setup(t, kind);
    const storage = memoryStorage();
    const options = { storage, env: storageEnv, now: new Date(time) };
    const submitted = await submitPublication(ctx.db, ctx.owner, {
      action: "submit-publication",
      brandId: ctx.brandId,
      operationId: randomUUID(),
      versionId: ctx.versionId,
      targetAccount: "restricted",
      pageUrl: "https://portal.example.com/login-wall",
      publisherId: ctx.owner,
      claimedPublishedAt: "2026-11-19T10:00:00.000Z",
      channelDeclaration: "portal",
      fixturePage: {
        accessClass: "login_wall",
        httpStatus: 401,
        title: "Login",
        bodyText: "Please sign in",
      },
    }, clock);
    assert.equal(submitted.error, undefined);
    assert.equal(submitted.status, "access_limited");
    assert.equal(submitted.effectiveAt, null);

    const rejected = await submitManualEvidence(ctx.db, ctx.owner, {
      ...evidenceInput(ctx.brandId, submitted.publicationId),
      screenshotRef: "fixture://shot",
    }, clock, {
      ...options,
      file: { fileName: "notes.txt", contentType: "text/plain", body: Uint8Array.from([1]) },
    });
    assert.equal(rejected.error, "EVIDENCE_TYPE_REJECTED");

    const huge = new Uint8Array(MAX_STORED_OBJECT_BYTES + 1);
    huge[0] = 1;
    const oversized = await submitManualEvidence(ctx.db, ctx.owner, {
      ...evidenceInput(ctx.brandId, submitted.publicationId),
      screenshotRef: "fixture://shot",
    }, clock, {
      ...options,
      file: { fileName: "huge.jpg", contentType: "image/jpeg", body: huge },
    });
    assert.equal(oversized.error, "EVIDENCE_TOO_LARGE");
    assert.equal((await queryWithParameters(
      ctx.db,
      `SELECT id FROM stored_object WHERE brand_id = ? AND "class" = 'publication-evidence'`,
      [ctx.brandId],
    )).length, 0);

    const manual = await submitManualEvidence(ctx.db, ctx.owner, evidenceInput(ctx.brandId, submitted.publicationId), clock, {
      ...options,
      file: { fileName: "shot.jpg", contentType: "image/jpeg", body: jpeg },
    });
    assert.equal(manual.error, undefined);
    assert.equal(manual.status, "verified_manual");
    assert.equal(manual.evidenceGrade, "manual");
    assert.equal(manual.screenshot.sha256, digest(jpeg));
    assert.equal(manual.screenshot.contentType, "image/jpeg");
    const encoded = JSON.stringify(manual);
    assert.equal(encoded.includes("verified_public"), false);
    assert.equal(encoded.includes("http://"), false);
    assert.equal(encoded.includes("https://"), false);
    assert.equal(encoded.includes("v1/"), false);
    assert.equal(encoded.includes("anonymous"), false);

    const detail = await readPublication(ctx.db, ctx.owner, submitted.publicationId);
    assert.equal(detail.publication.status, "verified_manual");
    assert.equal(detail.publication.evidenceGrade, "manual");
    assert.equal(detail.publication.pageUrl, "https://portal.example.com/login-wall");
    assert.equal(detail.publication.effectiveAt, time);
    const storedCheck = detail.checks.find((check) => check.method === "manual_evidence");
    const evidence = JSON.parse(storedCheck.evidenceJson);
    assert.equal(evidence.screenshotObjectId, manual.screenshot.objectId);
    assert.equal(evidence.screenshotRef, manual.screenshot.objectId);
    assert.equal(evidence.evidenceGrade, "manual");
    assert.equal(evidence.objectKey, undefined);

    const [row] = await queryWithParameters(
      ctx.db,
      `SELECT "class" AS "class", visibility, immutable, sha256, file_name AS "fileName"
       FROM stored_object WHERE id = ?`,
      [manual.screenshot.objectId],
    );
    assert.equal(row.class, "publication-evidence");
    assert.equal(row.visibility, "internal");
    assert.equal(Number(row.immutable), 1);
    assert.equal(row.sha256, digest(jpeg));
    assert.equal(row.fileName, "shot.jpg");

    const read = await readPublicationEvidence(
      ctx.db, ctx.owner, submitted.publicationId, manual.screenshot.objectId, options,
    );
    assert.equal(read.error, undefined);
    assert.equal(read.sha256, digest(jpeg));
    assert.equal(read.byteSize, jpeg.byteLength);
    assert.deepEqual(read.body, jpeg);
    assert.equal(read.evidenceGrade, "manual");
    assert.equal(JSON.stringify(read).includes("v1/"), false);

    const outsider = await readPublicationEvidence(
      ctx.db, ctx.outsider, submitted.publicationId, manual.screenshot.objectId, options,
    );
    assert.equal(outsider.error, "NOT_FOUND");
    assert.equal(JSON.stringify(outsider).includes(digest(jpeg)), false);
    assert.equal("body" in outsider, false);

    const signed = await presignStoredObject(ctx.db, {
      actorId: ctx.owner,
      objectId: manual.screenshot.objectId,
    }, options);
    assert.deepEqual(signed, { ok: false, code: "not-found" });
    assert.equal(JSON.stringify(signed).includes("http"), false);

    const replaced = await saveStoredObject(ctx.db, {
      actorId: ctx.owner,
      brandId: ctx.brandId,
      class: "publication-evidence",
      visibility: "internal",
      fileName: "shot.jpg",
      contentType: "image/jpeg",
      objectId: manual.screenshot.objectId,
      body: png,
    }, options);
    assert.equal(replaced.ok, false);
    assert.equal(replaced.code, "immutable");

    const again = await submitManualEvidence(ctx.db, ctx.owner, evidenceInput(ctx.brandId, submitted.publicationId), laterClock, {
      ...options,
      now: new Date(later),
      file: { fileName: "shot-2.png", contentType: "image/png", body: png },
    });
    assert.equal(again.error, undefined);
    assert.equal(again.status, "verified_manual");
    assert.equal(again.evidenceGrade, "manual");
    assert.equal(again.effectiveAt, time);
    assert.notEqual(again.screenshot.objectId, manual.screenshot.objectId);

    const first = await readPublicationEvidence(
      ctx.db, ctx.owner, submitted.publicationId, manual.screenshot.objectId, options,
    );
    assert.deepEqual(first.body, jpeg);
    const second = await readPublicationEvidence(
      ctx.db, ctx.owner, submitted.publicationId, again.screenshot.objectId, options,
    );
    assert.deepEqual(second.body, png);
    assert.equal((await queryWithParameters(
      ctx.db,
      `SELECT id FROM stored_object WHERE brand_id = ? AND "class" = 'publication-evidence' AND status = 'ready'`,
      [ctx.brandId],
    )).length, 2);
  });
}
