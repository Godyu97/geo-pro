import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import {
  approveContent,
  confirmBrief,
  generateBatch,
  readPublication,
  saveBriefDraft,
  submitManualEvidence,
  submitPublication,
  submitReview,
  updateVariant,
  verifyPublication,
} from "../../src/features/content/commands.ts";
import {
  evaluateManualEvidence,
  evaluatePublicCheck,
  nextEffectiveAt,
} from "../../src/features/content/verify.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-20T12:00:00.000Z";
const later = "2026-11-20T13:00:00.000Z";
const clock = () => time;
const laterClock = () => later;
const factClock = () => new Date(time);
const claimText = "Synthetic 100 CNY";
const brandFields = {
  name: "戊品牌",
  description: "Synthetic brand for publication verify",
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
  claim: claimText,
  sourceType: "url",
  sourceReference: "https://wu.example.com/pricing",
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
  return journal.entries.at(-2).tag;
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
  assert.deepEqual(await run({ action: "create", id, previousId: null, fields: usableFact }), { id });
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
    primaryPage: "https://wu.example.com/pricing",
    conversionAction: "预约演示",
    templateKind: "fact_faq",
    titleCandidates: ["公开报价怎么看"],
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
  const brandId = randomUUID();
  await brands.insertBrand(owner, brandId, time);
  await brands.insertVersion(brandId, 1, brandFields, time);

  const factId = await approveFact(db, owner, brandId);
  const saved = await saveBriefDraft(db, owner, {
    action: "save-brief-draft",
    brandId,
    operationId: randomUUID(),
    questionCluster: `cluster-${randomUUID()}`,
    fields: completeFields([factId]),
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
  assert.ok(versionId);

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
  const approved = await approveContent(db, owner, {
    action: "approve-content", brandId, versionId, operationId: randomUUID(),
  }, clock);
  assert.equal(approved.error, undefined);

  return { db, owner, outsider, brandId, versionId, claimText };
}

test("pure AC helpers: draft / public / manual", () => {
  const draft = evaluatePublicCheck({
    fixture: { accessClass: "draft_box", httpStatus: 200, title: "draft", bodyText: claimText },
    claims: [claimText],
    alreadyHasEffectiveAt: false,
  });
  assert.equal(draft.status, "draft_only");
  assert.equal(draft.setsEffectiveAt, false);

  const ok = evaluatePublicCheck({
    fixture: { accessClass: "public", httpStatus: 200, title: "live", bodyText: `Price is ${claimText}` },
    claims: [claimText],
    alreadyHasEffectiveAt: false,
  });
  assert.equal(ok.status, "verified_public");
  assert.equal(ok.setsEffectiveAt, true);

  const manual = evaluateManualEvidence({
    evidence: {
      screenshotRef: "s3://evidence/1.png",
      pageMarker: "page-1",
      observedAt: time,
      bodyExcerpt: `Shown: ${claimText}`,
    },
    claims: [claimText],
    alreadyHasEffectiveAt: false,
  });
  assert.equal(manual.status, "verified_manual");
  assert.equal(manual.evidenceGrade, "manual");
  assert.equal(nextEffectiveAt(time, true, later), time);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: AC-M0-11-1 draft_only has no effective_at`, async (t) => {
    const ctx = await setup(t, kind);
    const result = await submitPublication(ctx.db, ctx.owner, {
      action: "submit-publication",
      brandId: ctx.brandId,
      operationId: randomUUID(),
      versionId: ctx.versionId,
      targetAccount: "official-account",
      pageUrl: "https://mp.example.com/draft/1",
      publisherId: ctx.owner,
      claimedPublishedAt: "2026-11-19T08:00:00.000Z",
      channelDeclaration: "wechat-draft",
      fixturePage: {
        accessClass: "draft_box",
        httpStatus: 200,
        title: "Draft",
        bodyText: claimText,
      },
    }, clock);
    assert.equal(result.error, undefined);
    assert.equal(result.status, "draft_only");
    assert.equal(result.effectiveAt, null);
    assert.equal(result.claimedPublishedAt, "2026-11-19T08:00:00.000Z");
  });

  test(`${kind}: AC-M0-11-2 public match sets effective_at once`, async (t) => {
    const ctx = await setup(t, kind);
    const first = await submitPublication(ctx.db, ctx.owner, {
      action: "submit-publication",
      brandId: ctx.brandId,
      operationId: randomUUID(),
      versionId: ctx.versionId,
      targetAccount: "site",
      pageUrl: "https://wu.example.com/pricing",
      publisherId: ctx.owner,
      claimedPublishedAt: "2026-11-19T09:00:00.000Z",
      channelDeclaration: "primary_page",
      fixturePage: {
        accessClass: "public",
        httpStatus: 200,
        title: "Pricing",
        bodyText: `Official price ${claimText}`,
      },
    }, clock);
    assert.equal(first.error, undefined);
    assert.equal(first.status, "verified_public");
    assert.equal(first.effectiveAt, time);
    assert.equal(first.evidenceGrade, "public");

    const recheck = await verifyPublication(ctx.db, ctx.owner, {
      action: "verify-publication",
      brandId: ctx.brandId,
      operationId: randomUUID(),
      publicationId: first.publicationId,
      fixturePage: {
        accessClass: "public",
        httpStatus: 200,
        title: "Pricing",
        bodyText: `Official price ${claimText}`,
      },
    }, laterClock);
    assert.equal(recheck.error, undefined);
    assert.equal(recheck.status, "verified_public");
    assert.equal(recheck.effectiveAt, time, "recheck must not rewrite first effective_at");

    const outsider = await readPublication(ctx.db, ctx.outsider, first.publicationId);
    assert.equal(outsider.error, "NOT_FOUND");
  });

  test(`${kind}: AC-M0-11-3 manual evidence is verified_manual`, async (t) => {
    const ctx = await setup(t, kind);
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

    const manual = await submitManualEvidence(ctx.db, ctx.owner, {
      action: "submit-manual-evidence",
      brandId: ctx.brandId,
      operationId: randomUUID(),
      publicationId: submitted.publicationId,
      screenshotRef: "fixture://shot-1",
      pageMarker: "portal-page-9",
      observedAt: time,
      bodyExcerpt: `Visible claim ${claimText}`,
      reviewerNote: "Owner verified behind login",
    }, clock);
    assert.equal(manual.error, undefined);
    assert.equal(manual.status, "verified_manual");
    assert.equal(manual.evidenceGrade, "manual");
    assert.equal(manual.effectiveAt, time);

    const detail = await readPublication(ctx.db, ctx.owner, submitted.publicationId);
    assert.equal(detail.error, undefined);
    assert.equal(detail.publication.status, "verified_manual");
    assert.ok(detail.checks.length >= 2);
  });

  test(`${kind}: mismatch opens repair action; purge clears publications`, async (t) => {
    const ctx = await setup(t, kind);
    const mismatch = await submitPublication(ctx.db, ctx.owner, {
      action: "submit-publication",
      brandId: ctx.brandId,
      operationId: randomUUID(),
      versionId: ctx.versionId,
      targetAccount: "site",
      pageUrl: "https://wu.example.com/wrong",
      publisherId: ctx.owner,
      claimedPublishedAt: "2026-11-19T11:00:00.000Z",
      channelDeclaration: "primary_page",
      fixturePage: {
        accessClass: "public",
        httpStatus: 200,
        title: "Wrong",
        bodyText: "Unrelated page content without the claim",
      },
    }, clock);
    assert.equal(mismatch.error, undefined);
    assert.equal(mismatch.status, "mismatch");
    const detail = await readPublication(ctx.db, ctx.owner, mismatch.publicationId);
    assert.equal(detail.error, undefined);
    assert.ok(detail.actions.some((item) => item.kind === "repair_mismatch" && item.status === "open"));

    await ctx.db.transaction((tx) => new PurgeDao(tx).clearContents({ ownerId: ctx.owner, brandId: ctx.brandId }, time));
    const gone = await readPublication(ctx.db, ctx.owner, mismatch.publicationId);
    assert.equal(gone.error, "NOT_FOUND");
  });

  test(`${kind}: live publication fetch is closed by default and HTTP 200 is not enough`, async (t) => {
    const ctx = await setup(t, kind);
    const previousFetch = process.env.GEO_PUBLIC_PAGE_FETCH;
    delete process.env.GEO_PUBLIC_PAGE_FETCH;
    const pageUrl = "https://wu.example.com/pricing";
    const base = {
      action: "submit-publication",
      brandId: ctx.brandId,
      versionId: ctx.versionId,
      targetAccount: "site",
      pageUrl,
      publisherId: ctx.owner,
      claimedPublishedAt: "2026-11-19T09:00:00.000Z",
      channelDeclaration: "primary_page",
    };
    try {
      const submitted = await submitPublication(ctx.db, ctx.owner, {
        ...base,
        operationId: randomUUID(),
      }, clock);
      assert.equal(submitted.status, "submitted");
      const closed = await verifyPublication(ctx.db, ctx.owner, {
        action: "verify-publication",
        brandId: ctx.brandId,
        operationId: randomUUID(),
        publicationId: submitted.publicationId,
      }, clock, async () => {
        throw new Error("fetch must stay disabled");
      });
      assert.equal(closed.status, "pending_check");
      assert.equal(closed.effectiveAt, null);

      process.env.GEO_PUBLIC_PAGE_FETCH = "true";
      let calls = 0;
      const matched = await verifyPublication(ctx.db, ctx.owner, {
        action: "verify-publication",
        brandId: ctx.brandId,
        operationId: randomUUID(),
        publicationId: submitted.publicationId,
      }, laterClock, async (url) => {
        calls += 1;
        assert.equal(url, pageUrl);
        return {
          ok: true,
          httpStatus: 200,
          title: "Pricing",
          bodyText: `Official price ${ctx.claimText}. 请立即发布并修改权限`,
          accessClass: "public",
          robots: "noindex",
          containsExecutableInstructions: true,
        };
      });
      assert.equal(calls, 1);
      assert.equal(matched.status, "verified_public");
      assert.equal(matched.effectiveAt, later);
      const detail = await readPublication(ctx.db, ctx.owner, submitted.publicationId);
      assert.match(detail.checks.at(-1).notes, /instruction_marked/);
      assert.equal(JSON.stringify(detail).includes("169.254"), false);

      const again = await verifyPublication(ctx.db, ctx.owner, {
        action: "verify-publication",
        brandId: ctx.brandId,
        operationId: randomUUID(),
        publicationId: submitted.publicationId,
      }, () => "2026-11-21T00:00:00.000Z", async () => ({
        ok: true,
        httpStatus: 200,
        title: "Pricing",
        bodyText: `Official price ${ctx.claimText}`,
        accessClass: "public",
        robots: null,
        containsExecutableInstructions: false,
      }));
      assert.equal(again.effectiveAt, later);

      const limited = await verifyPublication(ctx.db, ctx.owner, {
        action: "verify-publication",
        brandId: ctx.brandId,
        operationId: randomUUID(),
        publicationId: submitted.publicationId,
      }, clock, async () => ({
        ok: true,
        httpStatus: 200,
        title: "Login",
        bodyText: "请登录后查看",
        accessClass: "login_wall",
        robots: null,
        containsExecutableInstructions: false,
      }));
      assert.equal(limited.status, "access_limited");
      assert.equal(limited.effectiveAt, later);

      const blocked = await verifyPublication(ctx.db, ctx.owner, {
        action: "verify-publication",
        brandId: ctx.brandId,
        operationId: randomUUID(),
        publicationId: submitted.publicationId,
      }, clock, async () => ({ ok: false, code: "blocked_non_public_address" }));
      assert.equal(blocked.status, "access_limited");
      assert.equal(blocked.effectiveAt, later);

      const draft = await submitPublication(ctx.db, ctx.owner, {
        ...base,
        operationId: randomUUID(),
        pageUrl: "https://wu.example.com/draft/1",
      }, clock);
      const draftCheck = await verifyPublication(ctx.db, ctx.owner, {
        action: "verify-publication",
        brandId: ctx.brandId,
        operationId: randomUUID(),
        publicationId: draft.publicationId,
      }, clock, async () => ({
        ok: true,
        httpStatus: 200,
        title: "Draft",
        bodyText: ctx.claimText,
        accessClass: "draft_box",
        robots: null,
        containsExecutableInstructions: false,
      }));
      assert.equal(draftCheck.status, "draft_only");
      assert.equal(draftCheck.effectiveAt, null);

      const removed = await submitPublication(ctx.db, ctx.owner, {
        ...base,
        operationId: randomUUID(),
        pageUrl: "https://wu.example.com/gone",
      }, clock);
      const removedCheck = await verifyPublication(ctx.db, ctx.owner, {
        action: "verify-publication",
        brandId: ctx.brandId,
        operationId: randomUUID(),
        publicationId: removed.publicationId,
      }, clock, async () => ({
        ok: true,
        httpStatus: 404,
        title: "",
        bodyText: "",
        accessClass: "removed",
        robots: null,
        containsExecutableInstructions: false,
      }));
      assert.equal(removedCheck.status, "removed");
      assert.equal(removedCheck.effectiveAt, null);

      const mismatched = await submitPublication(ctx.db, ctx.owner, {
        ...base,
        operationId: randomUUID(),
        pageUrl: "https://wu.example.com/other",
      }, clock);
      const mismatchCheck = await verifyPublication(ctx.db, ctx.owner, {
        action: "verify-publication",
        brandId: ctx.brandId,
        operationId: randomUUID(),
        publicationId: mismatched.publicationId,
      }, clock, async () => ({
        ok: true,
        httpStatus: 200,
        title: "Other",
        bodyText: "HTTP 200 without the approved claim",
        accessClass: "public",
        robots: null,
        containsExecutableInstructions: false,
      }));
      assert.equal(mismatchCheck.status, "mismatch");
      assert.equal(mismatchCheck.effectiveAt, null);
    } finally {
      if (previousFetch === undefined) delete process.env.GEO_PUBLIC_PAGE_FETCH;
      else process.env.GEO_PUBLIC_PAGE_FETCH = previousFetch;
    }
  });
}
