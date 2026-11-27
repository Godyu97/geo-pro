import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { importSourceOriginals } from "../../src/features/asset-reuse/commands.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { expireImageAsset, readImageAsset, registerImageAsset, registerImageAssetUse, revokeImageAsset } from "../../src/features/asset-reuse/image-asset-commands.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { publishChannelProfile } from "../../src/features/channel-variants/commands.ts";
import {
  approveChannelVariant,
  approveContent,
  confirmBrief,
  exportConfirm,
  exportPreflight,
  generateBatch,
  readContentVersion,
  readChannelVariants,
  readDeliveryPackage,
  readExportJob,
  registerAsset,
  rejectContent,
  saveBriefDraft,
  saveChannelVariant,
  submitReview,
  updateVariant,
} from "../../src/features/content/commands.ts";
import {
  buildPackageFiles,
  computeApprovalFingerprint,
  sanitizeHtml,
  validateExportSubset,
} from "../../src/features/content/package.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { grantBrandMember } from "../../src/features/team-access/commands.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

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

const time = "2026-11-20T11:00:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);
const brandFields = {
  name: "丁品牌",
  description: "Synthetic brand for approval export",
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
  claim: "Synthetic 100 CNY",
  sourceType: "url",
  sourceReference: "https://ding.example.com/pricing",
  sourceLocator: "Section 1",
  sourceExcerpt: "Public price excerpt",
  sourceDate: "2026-11-18",
  permission: "public",
  validity: "dated",
  validThrough: "2026-12-31",
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(
    kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json",
    "utf8",
  ));
  // Migrate through the revision immediately before content approval export.
  const target = kind === "sqlite" ? "0016_content_approval_export" : "0017_content_approval_export";
  const index = journal.entries.findIndex((entry) => entry.tag === target);
  if (index <= 0) throw new Error(`missing migration ${target}`);
  return journal.entries[index - 1].tag;
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Approval owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function approveFact(db, ownerId, brandId, claim) {
  const id = randomUUID();
  const run = (command) => executeFactCommand(db, { ownerId, brandId }, command, factClock);
  assert.deepEqual(await run({ action: "create", id, previousId: null, fields: { ...usableFact, claim } }), { id });
  assert.deepEqual(await run({ action: "submit", id, revision: 1 }), { id });
  assert.deepEqual(await run({
    action: "approve", id, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
  }), { id });
  return id;
}

function completeFields(factVersionIds) {
  return {
    audience: "采购负责人",
    targetGap: "价格口径不清晰",
    applicableBoundary: "仅适用于公开报价页",
    primaryPage: "https://ding.example.com/pricing",
    conversionAction: "预约演示",
    templateKind: "fact_faq",
    titleCandidates: ["公开报价怎么看", "价格口径说明"],
    factVersionIds,
    competitorSource: null,
  };
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
  const brands = new BrandDao(db);
  const newBrand = async (ownerId = owner) => {
    const id = randomUUID();
    await brands.insertBrand(ownerId, id, time);
    await brands.insertVersion(id, 1, brandFields, time);
    return id;
  };
  const brand = await newBrand();
  const storage = memoryStorage();
  const packageOptions = { env: storageEnv, storage, now: new Date(time) };

  /** Generates one draft ContentVersion per claim in a single batch. */
  async function drafts(claims, makeFact = (claim) => approveFact(db, owner, brand, claim)) {
    const factIds = [];
    const briefIds = [];
    for (const [index, claim] of claims.entries()) {
      const factId = await makeFact(claim);
      factIds.push(factId);
      const saved = await saveBriefDraft(db, owner, {
        action: "save-brief-draft",
        brandId: brand,
        operationId: randomUUID(),
        questionCluster: `cluster-${randomUUID()}-${index}`,
        fields: completeFields([factId]),
      }, clock);
      assert.equal(saved.error, undefined);
      const confirmed = await confirmBrief(db, owner, {
        action: "confirm-brief", brandId: brand, briefId: saved.briefId, operationId: randomUUID(),
      }, clock);
      assert.equal(confirmed.error, undefined);
      briefIds.push(saved.briefId);
    }
    const batch = await generateBatch(db, owner, {
      action: "generate-batch", brandId: brand, operationId: randomUUID(), briefIds,
    }, clock);
    assert.equal(batch.error, undefined);
    return {
      factIds,
      versionIds: batch.units.map((unit) => unit.contentVersionId),
    };
  }

  const base = (extra) => ({ brandId: brand, operationId: randomUUID(), ...extra });
  const act = {
    update: (versionId, patch, who = owner) =>
      updateVariant(db, who, base({ action: "update-variant", versionId, ...patch }), clock),
    submit: (versionId, who = owner) =>
      submitReview(db, who, base({ action: "submit-review", versionId }), clock),
    approve: (versionId, who = owner) =>
      approveContent(db, who, base({ action: "approve-content", versionId }), clock),
    reject: (versionId, who = owner) =>
      rejectContent(db, who, base({ action: "reject-content", versionId }), clock),
    asset: (patch, who = owner, brandId = brand, file) =>
      registerAsset(db, who, {
        action: "register-asset",
        brandId,
        operationId: randomUUID(),
        kind: "inline",
        source: "Studio photo",
        rightsStatement: "Owned by brand",
        visibility: "public",
        reviewStatus: "approved",
        contentRef: "ref://public-image",
        ...patch,
      }, clock, { ...packageOptions, file }),
    preflight: (versionIds, operationId = randomUUID(), mode = "auto", who = owner) =>
      exportPreflight(db, who, { action: "export-preflight", brandId: brand, operationId, versionIds, mode }, clock),
    confirm: (operationId, chosenVersionIds, who = owner) =>
      exportConfirm(db, who, { action: "export-confirm", brandId: brand, operationId, chosenVersionIds }, clock, packageOptions),
    readPackage: (packageId, who = owner) => readDeliveryPackage(db, who, packageId, packageOptions),
    verify: (versionId) =>
      updateVariant(db, owner, base({
        action: "update-variant",
        versionId,
        labelingProfileVersion: "profile-2026-11",
        labelingProfileStatus: "verified",
      }), clock),
    /** draft → in_review → approved with a verified labeling profile. */
    async approved(versionId, { verified = true } = {}) {
      if (verified) assert.equal((await act.verify(versionId)).error, undefined);
      assert.equal((await act.submit(versionId)).status, "in_review");
      const approved = await act.approve(versionId);
      assert.equal(approved.error, undefined);
      assert.equal(approved.status, "approved");
      return approved;
    },
  };
  const count = async (table, where = "brand_id = ?", values = [brand]) => {
    const [row] = await queryWithParameters(db, `SELECT count(*) AS n FROM ${table} WHERE ${where}`, values);
    return Number(row.n);
  };
  return { db, owner, outsider, brand, newBrand, drafts, act, count, packageOptions };
}

test("pure: approval fingerprint covers every variant field", () => {
  const input = {
    title: "T",
    bodyMarkdown: "B",
    claims: { claim: "fact" },
    imageAssetIds: [],
    targetChannel: "primary_page",
    labelingProfileVersion: "unverified",
    labelingProfileStatus: "unverified",
    factVersionIds: ["f1"],
  };
  const base = computeApprovalFingerprint(input);
  assert.equal(computeApprovalFingerprint({ ...input }), base);
  for (const patch of [
    { title: "T2" },
    { bodyMarkdown: "B2" },
    { claims: { claim: "other" } },
    { imageAssetIds: ["a"] },
    { targetChannel: "other" },
    { labelingProfileVersion: "v2" },
    { labelingProfileStatus: "verified" },
    { factVersionIds: ["f2"] },
  ]) {
    assert.notEqual(computeApprovalFingerprint({ ...input, ...patch }), base, JSON.stringify(patch));
  }
});

test("pure: sanitizeHtml strips scripts, handlers and unsafe URLs", () => {
  const dirty = [
    "<p onclick=\"x()\">hi <b>there</b></p>",
    "<script>alert(1)</script>",
    "<img src=\"https://ok.example/a.png\" onerror=\"alert(1)\" alt=\"a\">",
    "<a href=\"javascript:alert(1)\">bad</a>",
    "<a href=\"https://ok.example\" style=\"x\">good</a>",
    "<iframe src=\"https://evil\"></iframe>",
    "a < b",
  ].join("\n");
  const clean = sanitizeHtml(dirty);
  assert.doesNotMatch(clean, /<script|onerror|onclick|javascript:|<iframe|style=/i);
  assert.match(clean, /<b>there<\/b>/);
  assert.match(clean, /<a href="https:\/\/ok\.example">good<\/a>/);
  assert.match(clean, /<img src="https:\/\/ok\.example\/a\.png" alt="a">/);
  assert.match(clean, /a &lt; b/);
});

test("pure: package files are deterministic and keep internal assets out", () => {
  const input = {
    kind: "formal",
    approvalId: "approval-1",
    contentFingerprint: "fp",
    version: {
      id: "v1", title: "T", bodyMarkdown: "# T\n\nbody <script>x</script>", targetChannel: "primary_page",
      labelingProfileVersion: "p1", labelingProfileStatus: "verified", factVersionIds: ["f1"],
    },
    facts: [{
      id: "f1", factId: "ff", version: 1, claim: "c", title: "t", sourceType: "internal",
      sourceReference: "internal-attachment-name", sourceLocator: "s1", sourceExcerpt: "public excerpt", sourceDate: "2026-11-18",
    }],
    assets: [
      { id: "a1", kind: "cover", source: "S", rightsStatement: "R", visibility: "public", reviewStatus: "approved", contentRef: "ref://pub", fingerprint: "x" },
      { id: "a2", kind: "other", source: "SECRET-SOURCE", rightsStatement: "SECRET-RIGHTS", visibility: "internal", reviewStatus: "approved", contentRef: "ref://SECRET", fingerprint: "y" },
      { id: "a3", kind: "other", source: "PENDING-SOURCE", rightsStatement: "R", visibility: "public", reviewStatus: "pending", contentRef: "ref://PENDING", fingerprint: "z" },
    ],
  };
  const first = buildPackageFiles(input);
  assert.deepEqual(buildPackageFiles(input), first);
  const blob = Object.values(first.files).join("\n");
  assert.doesNotMatch(blob, /SECRET|PENDING|internal-attachment-name|<script/);
  assert.match(first.files["public-images.json"], /ref:\/\/pub/);
  assert.equal(JSON.parse(first.files["manifest.json"]).excludedAssetCount, 2);
  for (const name of ["content.md", "content.html", "manifest.json", "public-sources.json", "publish-checklist.md"]) {
    assert.ok(name in first.files, name);
  }
  const review = buildPackageFiles({ ...input, kind: "review" });
  assert.match(review.files["content.md"], /NON-PUBLISHABLE/);
  assert.equal(JSON.parse(review.files["manifest.json"]).nonPublishable, true);
  assert.notEqual(review.packageFingerprint, first.packageFingerprint);
});

test("pure: export subset must be non-empty, selected and eligible", () => {
  assert.deepEqual(validateExportSubset(["a", "b", "c"], ["a", "c"], ["a", "c"]), { ok: true });
  assert.deepEqual(validateExportSubset(["a", "b", "c"], ["a", "c"], ["a", "b"]), { ok: false, invalid: ["b"] });
  assert.deepEqual(validateExportSubset(["a"], ["a"], ["z"]), { ok: false, invalid: ["z"] });
  assert.equal(validateExportSubset(["a"], ["a"], []).ok, false);
});

for (const kind of ["sqlite", "postgresql"]) {
  const run = (name, body) => test(`${kind}: ${name}`, async (t) => {
    await body(t, await setup(t, kind));
  });

  run("AC-M0-10-1 title change invalidates approval and blocks formal export", async (t, ctx) => {
    const { db, owner, act, count } = ctx;
    const { versionIds: [versionId] } = await ctx.drafts(["Synthetic 100 CNY"]);

    const draft = await readContentVersion(db, owner, versionId);
    assert.equal(draft.version.status, "draft");
    assert.equal(draft.version.targetChannel, "primary_page");
    assert.equal(draft.version.labelingProfileStatus, "unverified");
    assert.equal(JSON.parse(draft.version.factVersionIdsJson).length, 1);
    assert.equal(draft.approvals.length, 0, "generation never approves");
    assert.equal((await act.approve(versionId)).error, "INVALID_INPUT", "approval requires in_review");

    await act.approved(versionId);
    const approved = await readContentVersion(db, owner, versionId);
    assert.equal(approved.approvals.length, 1);
    assert.equal(approved.approvals[0].decision, "approved");
    assert.equal(approved.approvals[0].actorId, owner);
    assert.equal(approved.approvalCurrent, true);
    assert.equal(approved.approvals[0].contentFingerprint, approved.currentFingerprint);

    // A formal package exists before the edit and must be marked do-not-reuse afterwards.
    const op1 = randomUUID();
    const pre1 = await act.preflight([versionId], op1);
    assert.deepEqual(pre1.eligibleVersionIds, [versionId]);
    assert.equal(pre1.items[0].kind, "formal");
    const first = await act.confirm(op1, [versionId]);
    assert.equal(first.error, undefined);
    assert.equal(first.packages.length, 1);
    assert.equal(first.packages[0].kind, "formal");
    assert.equal(first.packages[0].nonPublishable, false);
    assert.equal(first.packages[0].approvalId, approved.approvals[0].id);

    // No-op update changes nothing; one character of the title voids the approval.
    const noop = await act.update(versionId, { title: approved.version.title });
    assert.equal(noop.changed, false);
    assert.equal((await readContentVersion(db, owner, versionId)).version.status, "approved");
    const edited = await act.update(versionId, { title: `${approved.version.title}!` });
    assert.equal(edited.error, undefined);
    assert.equal(edited.invalidated, true);
    assert.equal(edited.status, "invalidated");

    const after = await readContentVersion(db, owner, versionId);
    assert.equal(after.version.status, "invalidated");
    assert.equal(after.approvals.length, 1, "old approval stays readable");
    assert.equal(after.approvals[0].id, approved.approvals[0].id);
    assert.equal(after.approvalCurrent, false);
    assert.equal(after.packages.length, 1, "old package stays readable");
    assert.equal(after.packages[0].doNotReuse, true);
    const oldPackage = await act.readPackage(first.packages[0].id);
    assert.equal(oldPackage.error, undefined);
    assert.ok(oldPackage.files["content.md"].includes(approved.version.title));

    // Formal export is refused until a new approval matches the current fingerprint.
    const op2 = randomUUID();
    const pre2 = await act.preflight([versionId], op2, "formal");
    assert.deepEqual(pre2.eligibleVersionIds, []);
    assert.ok(pre2.items[0].blockers.includes("APPROVAL_REQUIRED"));
    assert.equal((await act.confirm(op2, [versionId])).error, "SUBSET_INVALID");
    assert.equal((await act.confirm(randomUUID(), [versionId])).error, "PREFLIGHT_REQUIRED");
    assert.equal(await count("content_delivery_package"), 1);

    // Re-review produces a second approval and a fresh, exportable fingerprint.
    assert.equal((await act.approve(versionId)).error, "INVALID_INPUT");
    assert.equal((await act.submit(versionId)).status, "in_review");
    const again = await act.approve(versionId);
    assert.equal(again.status, "approved");
    assert.notEqual(again.contentFingerprint, approved.currentFingerprint);
    const renewed = await readContentVersion(db, owner, versionId);
    assert.equal(renewed.approvals.length, 2);
    assert.equal(renewed.approvalCurrent, true);
    const op3 = randomUUID();
    assert.deepEqual((await act.preflight([versionId], op3, "formal")).eligibleVersionIds, [versionId]);
    assert.equal((await act.confirm(op3, [versionId])).packages.length, 1);
    const finalState = await readContentVersion(db, owner, versionId);
    assert.deepEqual(
      finalState.packages.map((pkg) => pkg.doNotReuse).sort(),
      [false, true],
    );
  });

  run("rejection is recorded and a rejected version cannot be approved", async (t, ctx) => {
    const { db, owner, act } = ctx;
    const { versionIds: [versionId] } = await ctx.drafts(["Synthetic 100 CNY"]);
    assert.equal((await act.reject(versionId)).error, "INVALID_INPUT");
    await act.submit(versionId);
    const rejected = await act.reject(versionId);
    assert.equal(rejected.status, "rejected");
    const detail = await readContentVersion(db, owner, versionId);
    assert.equal(detail.version.status, "rejected");
    assert.equal(detail.approvals[0].decision, "rejected");
    assert.equal((await act.approve(versionId)).error, "INVALID_INPUT");
    assert.equal((await act.submit(versionId)).status, "in_review");
  });

  run("AC-M0-10-2 formal package excludes internal assets and executable HTML", async (t, ctx) => {
    const { act, db, owner, brand, packageOptions } = ctx;
    const privateFragment = "INTERNAL-RAW-FRAGMENT for Synthetic 100 CNY";
    const { versionIds: [versionId], factIds: [linkedId] } = await ctx.drafts(["Synthetic 100 CNY"], async (claim) => {
      const imported = await importSourceOriginals(db, owner, { brandId: brand, files: [{
        name: "INTERNAL-ORIGINAL.txt", contentType: "text/plain", chars: privateFragment.length, encrypted: false,
        pages: [{ page: 1, text: privateFragment }], body: Buffer.from(privateFragment),
      }] }, packageOptions);
      const id = imported.files[0].fragments[0].id;
      const run = (command) => executeFactCommand(db, { ownerId: owner, brandId: brand }, command, factClock);
      assert.deepEqual(await run({ action: "createFromFragment", id }), { id });
      assert.deepEqual(await run({ action: "edit", id, revision: 1, fields: { ...usableFact, claim, sourceLocator: "1" } }), { id });
      assert.deepEqual(await run({ action: "approve", id, revision: 2, confirmed: true, conflictId: null, revokeConflict: false }), { id });
      return id;
    });
    const publicAsset = (await act.asset({ kind: "cover", source: "Public studio", contentRef: "ref://public-cover" })).asset;
    const internalAsset = (await act.asset({
      visibility: "internal",
      source: "INTERNAL-SOURCE-LABEL",
      rightsStatement: "INTERNAL-RIGHTS-NOTE",
      contentRef: "ref://INTERNAL-ATTACHMENT-BYTES",
    })).asset;
    assert.equal(internalAsset.visibility, "internal");

    const edited = await act.update(versionId, {
      bodyMarkdown: "# Public body\n\nSynthetic 100 CNY <script>alert('x')</script><img src=\"https://x.example/a.png\" onerror=\"alert(1)\">",
      imageAssetIds: [publicAsset.id, internalAsset.id],
    });
    assert.equal(edited.error, undefined);
    await act.approved(versionId);

    const op = randomUUID();
    const pre = await act.preflight([versionId], op, "formal");
    assert.deepEqual(pre.eligibleVersionIds, [versionId]);
    const exported = await act.confirm(op, [versionId]);
    assert.equal(exported.error, undefined);
    const [summary] = exported.packages;
    assert.equal(summary.kind, "formal");
    assert.equal(summary.nonPublishable, false);

    const read = await act.readPackage(summary.id);
    const blob = Object.values(read.files).join("\n");
    assert.doesNotMatch(blob, /INTERNAL-|ref:\/\/INTERNAL/i);
    assert.doesNotMatch(read.files["content.html"], /<script|onerror/i);
    assert.match(read.files["public-images.json"], /ref:\/\/public-cover/);
    assert.match(read.files["public-sources.json"], /Synthetic 100 CNY/);
    const source = JSON.parse(read.files["public-sources.json"]).sources[0];
    assert.equal(source.factVersionId, linkedId);
    assert.equal(source.sourceType, "internal");
    assert.equal(source.sourceReference, null);
    assert.equal(source.sourceExcerpt, usableFact.sourceExcerpt);
    assert.equal(source.sourceLocator, "1");
    assert.match(read.files["publish-checklist.md"], /not publication/i);
    const manifest = JSON.parse(read.files["manifest.json"]);
    assert.equal(manifest.packageKind, "formal");
    assert.equal(manifest.nonPublishable, false);
    assert.equal(manifest.approvalId, summary.approvalId);
    assert.equal(manifest.contentFingerprint, summary.contentFingerprint);
    assert.equal(manifest.imageCount, 1);
    assert.equal(manifest.excludedAssetCount, 1);
    assert.equal(read.package.packageFingerprint.length, 64);
  });

  run("AC-M0-10-3 batch preflight blocks one revoked fact and exports the explicit subset", async (t, ctx) => {
    const { db, owner, brand, act, count } = ctx;
    const { versionIds, factIds } = await ctx.drafts(["Synthetic A", "Synthetic B", "Synthetic C"]);
    for (const id of versionIds) await act.approved(id);

    const revoked = await executeFactCommand(db, { ownerId: owner, brandId: brand }, {
      action: "revoke", id: factIds[1], revision: 3, confirmed: true,
    }, factClock);
    assert.deepEqual(revoked, { id: factIds[1] });

    const op = randomUUID();
    const pre = await act.preflight(versionIds, op, "formal");
    assert.equal(pre.error, undefined);
    assert.equal(pre.items.length, 3, "no selection is silently omitted");
    const byId = Object.fromEntries(pre.items.map((item) => [item.versionId, item]));
    assert.deepEqual(byId[versionIds[1]].blockers, ["FACT_INVALID"]);
    assert.deepEqual(byId[versionIds[1]].invalidFactVersionIds, [factIds[1]]);
    assert.equal(byId[versionIds[0]].eligible, true);
    assert.equal(byId[versionIds[2]].eligible, true);
    assert.deepEqual([...pre.eligibleVersionIds].sort(), [versionIds[0], versionIds[2]].sort());

    // Preflight is idempotent per operation and cannot be re-used with another selection.
    assert.equal((await act.preflight(versionIds, op, "formal")).jobId, pre.jobId);
    assert.equal((await act.preflight([versionIds[0]], op, "formal")).error, "OPERATION_CONFLICT");

    // The owner must pick from the passing subset; the blocked one is refused.
    assert.equal((await act.confirm(op, versionIds)).error, "SUBSET_INVALID");
    assert.equal((await act.confirm(op, [versionIds[1]])).error, "SUBSET_INVALID");
    assert.equal(await count("content_delivery_package"), 0);

    const chosen = [versionIds[0], versionIds[2]];
    const done = await act.confirm(op, chosen);
    assert.equal(done.error, undefined);
    assert.equal(done.status, "ready");
    assert.equal(done.packages.length, chosen.length);
    assert.deepEqual(done.packages.map((pkg) => pkg.contentVersionId).sort(), [...chosen].sort());
    assert.equal(await count("content_delivery_package"), 2);
    assert.equal(await count("content_export_job"), 1);

    const replay = await act.confirm(op, chosen);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.packages.map((pkg) => pkg.id).sort(), done.packages.map((pkg) => pkg.id).sort());
    assert.equal((await act.confirm(op, [versionIds[0]])).error, "OPERATION_CONFLICT");
    assert.equal(await count("content_delivery_package"), 2);

    // Facts revoked after preflight are caught again at confirmation.
    const op2 = randomUUID();
    const pre2 = await act.preflight([versionIds[0]], op2, "formal");
    assert.deepEqual(pre2.eligibleVersionIds, [versionIds[0]]);
    await executeFactCommand(db, { ownerId: owner, brandId: brand }, {
      action: "revoke", id: factIds[0], revision: 3, confirmed: true,
    }, factClock);
    const stale = await act.confirm(op2, [versionIds[0]]);
    assert.equal(stale.error, "FACT_INVALID");
    assert.equal(stale.blockers[0].versionId, versionIds[0]);
    assert.equal(await count("content_delivery_package"), 2);

    // Purge removes exports before approvals, assets and versions without FK failures.
    await act.asset({});
    await db.transaction((tx) => new PurgeDao(tx).clearContents({ ownerId: owner, brandId: brand }, time));
    for (const table of ["content_export_job", "content_delivery_package", "content_approval", "content_asset", "content_version"]) {
      assert.equal(await count(table), 0, table);
    }
  });

  run("unverified labeling yields only a non-publishable review package", async (t, ctx) => {
    const { db, owner, act, count } = ctx;
    const { versionIds: [versionId] } = await ctx.drafts(["Synthetic 100 CNY"]);
    await act.approved(versionId, { verified: false });
    const version = (await readContentVersion(db, owner, versionId)).version;
    assert.equal(version.labelingProfileStatus, "unverified");

    const formalOp = randomUUID();
    const formal = await act.preflight([versionId], formalOp, "formal");
    assert.deepEqual(formal.eligibleVersionIds, []);
    assert.ok(formal.items[0].blockers.includes("LABELING_UNVERIFIED"));
    assert.equal((await act.confirm(formalOp, [versionId])).error, "SUBSET_INVALID");
    assert.equal(await count("content_delivery_package", "brand_id = ? AND kind = 'formal'", [ctx.brand]), 0);

    const op = randomUUID();
    const pre = await act.preflight([versionId], op, "auto");
    assert.equal(pre.items[0].kind, "review");
    assert.deepEqual(pre.eligibleVersionIds, [versionId]);
    const done = await act.confirm(op, [versionId]);
    assert.equal(done.error, undefined);
    const [summary] = done.packages;
    assert.equal(summary.kind, "review");
    assert.equal(summary.nonPublishable, true);
    const read = await act.readPackage(summary.id);
    assert.match(read.files["content.md"], /NON-PUBLISHABLE/);
    assert.match(read.files["content.html"], /NON-PUBLISHABLE/);
    assert.equal(JSON.parse(read.files["manifest.json"]).nonPublishable, true);
    assert.equal(await count("content_delivery_package", "brand_id = ? AND kind = 'formal'", [ctx.brand]), 0);
    assert.equal(await count("content_delivery_package", "brand_id = ? AND kind = 'review' AND non_publishable = 1", [ctx.brand]), 1);
  });

  run("image rights block preflight and stale confirms until the image is replaced", async (t, ctx) => {
    const { db, owner, outsider, brand, act, count } = ctx;
    const { versionIds: [draft, clear] } = await ctx.drafts(["Image rights", "No image"]);
    // Before public upload registration was linked, explicit ledger references were already stored.
    const legacy = (await registerImageAsset(db, owner, { brandId: brand, fileName: "old.png", version: 3 }, time)).asset;
    await registerImageAssetUse(db, owner, { brandId: brand, id: legacy.id, contentVersionId: draft }, time);
    await act.approved(draft);
    await act.approved(clear);
    const channel = "zhihu";
    const variantCommand = { brandId: brand, versionId: draft, channel, operationId: randomUUID() };
    const { version: profile } = await publishChannelProfile(db, owner, {
      brandId: brand, channelKey: channel, maxCharacters: null, note: "Channel image rights fixture",
    }, clock);
    const { version } = await readContentVersion(db, owner, draft);
    await saveChannelVariant(db, owner, {
      action: "save-channel-variant", ...variantCommand, bodyMarkdown: version.bodyMarkdown, profileVersionId: profile.id,
    }, clock);
    const originalVariantApproval = await approveChannelVariant(db, owner, {
      action: "approve-channel-variant", ...variantCommand,
    }, clock);
    assert.equal((await readChannelVariants(db, owner, draft)).variants[0].rejection, null);
    const issued = await act.preflight([draft], randomUUID(), "formal");
    const old = await act.confirm(issued.operationId, [draft]);
    const stale = await act.preflight([draft, clear], randomUUID(), "formal");

    const closed = await revokeImageAsset(db, owner, { brandId: brand, id: legacy.id }, time);
    assert.equal(closed.todos.length, 1);
    const expected = [{ id: legacy.id, fileName: "old.png", version: 3, reason: "revoked" }];
    const pre = await act.preflight([draft, clear], randomUUID(), "formal");
    assert.deepEqual(pre.eligibleVersionIds, [clear]);
    assert.deepEqual(pre.items[0].invalidImageAssets, expected);
    assert.deepEqual((await readExportJob(db, owner, brand, stale.operationId)).items[0].invalidImageAssets, expected);
    assert.deepEqual((await readChannelVariants(db, owner, draft)).invalidImageAssets, expected);

    const denied = await act.confirm(stale.operationId, [draft, clear]);
    assert.equal(denied.error, "IMAGE_RIGHTS_INVALID");
    assert.deepEqual(denied.blockers[0].invalidImageAssets, expected);
    assert.equal(await count("content_delivery_package"), 1);
    assert.equal((await act.readPackage(old.packages[0].id)).package.doNotReuse, true);
    assert.deepEqual((await act.confirm(pre.operationId, [clear])).packages.map((pkg) => pkg.contentVersionId), [clear]);
    assert.deepEqual(await readExportJob(db, outsider, brand, stale.operationId), { error: "NOT_FOUND" });

    const replacement = (await act.asset({}, owner, brand, {
      fileName: "replacement.png", contentType: "image/png", body: Buffer.from("isolated image fixture"),
    })).asset;
    assert.equal((await act.update(draft, { imageAssetIds: [replacement.id] })).status, "invalidated");
    assert.equal((await act.preflight([draft], randomUUID(), "formal")).items[0].blockers[0], "APPROVAL_REQUIRED");
    await act.approved(draft);
    assert.equal((await act.confirm(stale.operationId, [draft])).error, "PREFLIGHT_REQUIRED");
    assert.equal((await readChannelVariants(db, owner, draft)).variants[0].rejection, "variant_unapproved");
    const variantReapproval = await approveChannelVariant(db, owner, {
      action: "approve-channel-variant", ...variantCommand,
    }, clock);
    assert.notEqual(variantReapproval.approvalId, originalVariantApproval.approvalId);
    const next = await act.preflight([draft], randomUUID(), "formal");
    const confirmed = await Promise.all([
      act.confirm(next.operationId, [draft]),
      act.confirm(next.operationId, [draft]),
    ]);
    assert.deepEqual(confirmed.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(confirmed[0].packages[0].id, confirmed[1].packages[0].id);
    const delivery = await act.readPackage(confirmed[0].packages[0].id);
    assert.deepEqual(JSON.parse(delivery.files["public-images.json"]).images.map((image) => image.id), [replacement.id]);
    assert.equal((await readImageAsset(db, owner, { brandId: brand, id: legacy.id })).todos.length, 1);
    assert.equal((await readImageAsset(db, owner, { brandId: brand, id: replacement.id })).uses[0].assetVersion, 1);

    await expireImageAsset(db, owner, { brandId: brand, id: replacement.id }, time);
    const review = await act.preflight([draft], randomUUID(), "review");
    assert.equal(review.items[0].invalidImageAssets[0].reason, "expired");
    assert.equal(await count("content_delivery_package"), 3);
  });

  run("non-owners and foreign assets get NOT_FOUND without leaking content", async (t, ctx) => {
    const { db, owner, outsider, brand, act } = ctx;
    const { versionIds: [versionId] } = await ctx.drafts(["Synthetic 100 CNY"]);
    await act.approved(versionId);
    const op = randomUUID();
    await act.preflight([versionId], op);
    const exported = await act.confirm(op, [versionId]);
    const packageId = exported.packages[0].id;

    assert.equal((await readContentVersion(db, outsider, versionId)).error, "NOT_FOUND");
    assert.equal((await act.readPackage(packageId, outsider)).error, "NOT_FOUND");
    assert.equal((await act.submit(versionId, outsider)).error, "NOT_FOUND");
    assert.equal((await act.approve(versionId, outsider)).error, "NOT_FOUND");
    assert.equal((await act.reject(versionId, outsider)).error, "NOT_FOUND");
    assert.equal((await act.update(versionId, { title: "x" }, outsider)).error, "NOT_FOUND");
    assert.equal((await act.asset({}, outsider)).error, "NOT_FOUND");
    assert.equal((await act.preflight([versionId], randomUUID(), "auto", outsider)).error, "NOT_FOUND");
    assert.equal((await act.confirm(op, [versionId], outsider)).error, "NOT_FOUND");

    // An asset registered under another owner's brand cannot be attached.
    const otherBrand = await ctx.newBrand(outsider);
    const foreign = (await act.asset({}, outsider, otherBrand)).asset;
    assert.equal((await act.update(versionId, { imageAssetIds: [foreign.id] })).error, "NOT_FOUND");
    assert.equal((await readContentVersion(db, owner, versionId)).version.imageAssetIdsJson, "[]");

    // Frozen brands deny reads and downloads.
    await queryWithParameters(db, "UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ?", [time, time, brand]);
    assert.equal((await readContentVersion(db, owner, versionId)).error, "NOT_FOUND");
    assert.equal((await act.readPackage(packageId)).error, "NOT_FOUND");
  });

  run("read-only members see the draft without attachment or package metadata", async (t, ctx) => {
    const { db, owner, outsider: reader, brand, act } = ctx;
    const { versionIds: [versionId] } = await ctx.drafts(["Synthetic 100 CNY"]);
    const { asset } = await act.asset({ visibility: "internal", contentRef: "ref://internal-image" });
    assert.equal((await act.update(versionId, { imageAssetIds: [asset.id] })).error, undefined);
    const operationId = randomUUID();
    await act.preflight([versionId], operationId, "review");
    const exported = await act.confirm(operationId, [versionId]);
    const [pkg] = exported.packages;
    const ownerDetail = await readContentVersion(db, owner, versionId);
    assert.equal(ownerDetail.readOnly, false);
    assert.equal(ownerDetail.assets[0].contentRef, "ref://internal-image");
    assert.equal(ownerDetail.packages[0].id, pkg.id);

    const grant = await grantBrandMember(db, owner, { userId: reader, brandId: brand, role: "read_only", expiresAt: null }, time);
    assert.equal(grant.error, undefined);
    const readerDetail = await readContentVersion(db, reader, versionId);
    assert.equal(readerDetail.readOnly, true);
    assert.equal(readerDetail.readOnlyReason, "grant");
    assert.equal(readerDetail.version.bodyMarkdown, ownerDetail.version.bodyMarkdown);
    assert.equal(readerDetail.currentFingerprint, ownerDetail.currentFingerprint);
    assert.deepEqual(JSON.parse(readerDetail.version.imageAssetIdsJson), []);
    assert.deepEqual(readerDetail.assets, []);
    assert.deepEqual(readerDetail.packages, []);
    assert.equal((await act.submit(versionId, reader)).error, "NOT_FOUND");
    assert.equal((await act.preflight([versionId], randomUUID(), "review", reader)).error, "NOT_FOUND");
    assert.equal((await act.readPackage(pkg.id, reader)).error, "NOT_FOUND");
  });
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: migration upgrades existing draft versions in place`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));

    const owner = await account(db);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, brandFields, time);
    const [briefId, briefVersionId, batchId, unitId, versionId, factId] = Array.from({ length: 6 }, () => randomUUID());
    const run = (sql, values) => queryWithParameters(db, sql, values);
    await run("INSERT INTO content_brief (id, brand_id, owner_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [briefId, brand, owner, "confirmed", time, time]);
    await run(`INSERT INTO content_brief_version (id, brief_id, brand_id, revision, audience, target_gap,
      applicable_boundary, primary_page, conversion_action, template_kind, title_candidates_json,
      fact_version_ids_json, created_at) VALUES (?, ?, ?, 1, 'a', 'g', 'b', 'p', 'c', 'fact_faq', '["t"]', ?, ?)`,
    [briefVersionId, briefId, brand, JSON.stringify([factId]), time]);
    await run(`INSERT INTO content_batch (id, brand_id, owner_id, status, operation_id, cost_ledger_json, created_at, updated_at)
      VALUES (?, ?, ?, 'completed', ?, '{}', ?, ?)`, [batchId, brand, owner, randomUUID(), time, time]);
    await run(`INSERT INTO content_batch_unit (id, batch_id, brief_id, brand_id, status, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'succeeded', 1, ?, ?)`, [unitId, batchId, briefId, brand, time, time]);
    await run(`INSERT INTO content_version (id, brand_id, owner_id, brief_id, brief_version_id, batch_unit_id,
      template_kind, title, body_markdown, claims_json, status, fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'fact_faq', 'Old title', 'Old body', '{}', 'draft', 'fp', ?)`,
    [versionId, brand, owner, briefId, briefVersionId, unitId, time]);

    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const detail = await readContentVersion(db, owner, versionId);
    assert.equal(detail.error, undefined);
    assert.equal(detail.version.status, "draft");
    assert.equal(detail.version.title, "Old title");
    assert.equal(detail.version.targetChannel, "primary_page");
    assert.equal(detail.version.labelingProfileStatus, "unverified");
    assert.equal(detail.version.labelingProfileVersion, "unverified");
    assert.equal(detail.version.imageAssetIdsJson, "[]");
    assert.equal(detail.version.factVersionIdsJson, JSON.stringify([factId]));
    assert.equal(detail.version.updatedAt, detail.version.createdAt);
    // The relaxed CHECK now accepts review states; unknown states are still rejected.
    await run("UPDATE content_version SET status = 'in_review' WHERE id = ?", [versionId]);
    await assert.rejects(run("UPDATE content_version SET status = 'published' WHERE id = ?", [versionId]));
  });
}
