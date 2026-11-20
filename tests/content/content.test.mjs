import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import {
  confirmBrief,
  generateBatch,
  pauseBatch,
  readBatch,
  readBriefDetail,
  readContentVersion,
  resumeBatch,
  retryFailed,
  saveBriefDraft,
} from "../../src/features/content/commands.ts";
import { contentBriefGaps, fillDraftFromTemplate } from "../../src/features/content/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-20T11:00:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);
const fields = {
  name: "丙品牌",
  description: "Synthetic brand for content drafts",
  website: "https://bing.example.com",
  aliases: ["丙"],
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
  sourceType: "internal",
  sourceReference: "Internal attachment description",
  sourceLocator: "Section 1",
  sourceExcerpt: "Private evidence fixture",
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
    [id, "Content owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function approveFact(db, ownerId, brandId, claim = usableFact.claim) {
  const id = randomUUID();
  const scope = { ownerId, brandId };
  const run = (command) => executeFactCommand(db, scope, command, factClock);
  assert.deepEqual(await run({
    action: "create",
    id,
    previousId: null,
    fields: { ...usableFact, claim },
  }), { id });
  assert.deepEqual(await run({ action: "submit", id, revision: 1 }), { id });
  assert.deepEqual(await run({
    action: "approve",
    id,
    revision: 2,
    confirmed: true,
    conflictId: null,
    revokeConflict: false,
  }), { id });
  return id;
}

function completeFields(factVersionIds, overrides = {}) {
  return {
    audience: "采购负责人",
    targetGap: "价格口径不清晰",
    applicableBoundary: "仅适用于公开报价页",
    primaryPage: "https://bing.example.com/pricing",
    conversionAction: "预约演示",
    templateKind: "fact_faq",
    titleCandidates: ["公开报价怎么看", "价格口径说明"],
    factVersionIds,
    competitorSource: null,
    ...overrides,
  };
}

test("AC-M0-09-1 pure: missing source or boundary yields evidence gaps", () => {
  const gaps = contentBriefGaps(completeFields([], {
    applicableBoundary: "",
    factVersionIds: [],
  }));
  assert.ok(gaps.some((gap) => gap.code === "boundaryMissing"));
  assert.ok(gaps.some((gap) => gap.code === "sourceMissing"));
  const filled = fillDraftFromTemplate({
    templateKind: "fact_faq",
    titleCandidates: ["t"],
    audience: "a",
    targetGap: "g",
    applicableBoundary: "b",
    primaryPage: "https://bing.example.com/p",
    conversionAction: "cta",
    facts: [{ id: randomUUID(), claim: "claim-a" }],
  });
  assert.equal(filled.title, "t");
  assert.match(filled.bodyMarkdown, /claim-a/);
  assert.equal(Object.values(filled.claims).length, 1);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: AC-M0-09-1/2/3 content drafts, retry isolation, revoke resume, ownership`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const [owner, outsider] = await Promise.all([account(db), account(db)]);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);

    const factA = await approveFact(db, owner, brand, "Synthetic 100 CNY");
    const factB = await approveFact(db, owner, brand, "Synthetic SLA 99.9%");
    const factC = await approveFact(db, owner, brand, "Synthetic region CN");

    const incomplete = await saveBriefDraft(db, owner, {
      action: "save-brief-draft",
      brandId: brand,
      operationId: randomUUID(),
      questionCluster: "cluster-gap",
      fields: completeFields([], { applicableBoundary: "", factVersionIds: [] }),
    }, clock);
    assert.equal(incomplete.error, undefined);
    assert.ok(incomplete.gaps.some((gap) => gap.code === "boundaryMissing"));
    assert.ok(incomplete.gaps.some((gap) => gap.code === "sourceMissing"));

    const confirmGap = await confirmBrief(db, owner, {
      action: "confirm-brief",
      brandId: brand,
      briefId: incomplete.briefId,
      operationId: randomUUID(),
    }, clock);
    assert.equal(confirmGap.error, "EVIDENCE_REQUIRED");
    assert.ok(confirmGap.gaps.length > 0);

    const genGap = await generateBatch(db, owner, {
      action: "generate-batch",
      brandId: brand,
      operationId: randomUUID(),
      briefIds: [incomplete.briefId],
    }, clock);
    assert.equal(genGap.error, "EVIDENCE_REQUIRED");
    const versionsAfterGap = await queryWithParameters(
      db,
      "SELECT id FROM content_version WHERE brand_id = ?",
      [brand],
    );
    assert.equal(versionsAfterGap.length, 0);

    async function confirmedBrief(factId, cluster) {
      const saved = await saveBriefDraft(db, owner, {
        action: "save-brief-draft",
        brandId: brand,
        operationId: randomUUID(),
        questionCluster: cluster,
        fields: completeFields([factId]),
      }, clock);
      assert.equal(saved.error, undefined);
      const confirmed = await confirmBrief(db, owner, {
        action: "confirm-brief",
        brandId: brand,
        briefId: saved.briefId,
        operationId: randomUUID(),
      }, clock);
      assert.equal(confirmed.error, undefined);
      assert.equal(confirmed.status, "confirmed");
      return saved.briefId;
    }

    const brief1 = await confirmedBrief(factA, "cluster-1");
    const brief2 = await confirmedBrief(factB, "cluster-2");
    const brief3 = await confirmedBrief(factC, "cluster-3");

    const batchOp = randomUUID();
    const batch = await generateBatch(db, owner, {
      action: "generate-batch",
      brandId: brand,
      operationId: batchOp,
      briefIds: [brief1, brief2, brief3],
      fixtures: { failBriefIds: [brief3] },
    }, clock);
    assert.equal(batch.error, undefined);
    assert.equal(batch.units.length, 3);
    const succeeded = batch.units.filter((unit) => unit.status === "succeeded");
    const failed = batch.units.filter((unit) => unit.status === "failed");
    assert.equal(succeeded.length, 2);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].briefId, brief3);
    const successSnapshots = succeeded.map((unit) => ({
      unitId: unit.id,
      contentVersionId: unit.contentVersionId,
    }));
    const bodyBefore = {};
    for (const item of successSnapshots) {
      const detail = await readContentVersion(db, owner, item.contentVersionId);
      assert.equal(detail.error, undefined);
      assert.equal(detail.version.status, "draft");
      bodyBefore[item.contentVersionId] = detail.version.bodyMarkdown;
    }

    const replay = await generateBatch(db, owner, {
      action: "generate-batch",
      brandId: brand,
      operationId: batchOp,
      briefIds: [brief1, brief2, brief3],
      fixtures: { failBriefIds: [brief3] },
    }, clock);
    assert.equal(replay.replayed, true);

    const retried = await retryFailed(db, owner, {
      action: "retry-failed",
      brandId: brand,
      batchId: batch.batch.id,
      operationId: randomUUID(),
    }, clock);
    assert.equal(retried.error, undefined);
    for (const prior of successSnapshots) {
      const unit = retried.units.find((item) => item.id === prior.unitId);
      assert.equal(unit.contentVersionId, prior.contentVersionId);
      const detail = await readContentVersion(db, owner, prior.contentVersionId);
      assert.equal(detail.version.bodyMarkdown, bodyBefore[prior.contentVersionId]);
    }
    const failedUnit = retried.units.find((unit) => unit.briefId === brief3);
    assert.equal(failedUnit.status, "succeeded");
    assert.ok(failedUnit.attemptCount >= 2);
    assert.ok(failedUnit.contentVersionId);

    const brief4 = await confirmedBrief(factA, "cluster-4");
    const brief5Fact = await approveFact(db, owner, brand, "Synthetic revoke target");
    const brief5 = await confirmedBrief(brief5Fact, "cluster-5");
    const pausedBatch = await generateBatch(db, owner, {
      action: "generate-batch",
      brandId: brand,
      operationId: randomUUID(),
      briefIds: [brief4, brief5],
      fixtures: { pauseAfter: 0 },
    }, clock);
    assert.equal(pausedBatch.error, undefined);
    assert.equal(pausedBatch.batch.status, "paused");
    assert.equal(pausedBatch.units.every((unit) => unit.status === "queued"), true);

    const manualPause = await pauseBatch(db, owner, {
      action: "pause-batch",
      brandId: brand,
      batchId: pausedBatch.batch.id,
      operationId: randomUUID(),
    }, clock);
    assert.equal(manualPause.error, "INVALID_INPUT");

    const revoked = await executeFactCommand(db, { ownerId: owner, brandId: brand }, {
      action: "revoke",
      id: brief5Fact,
      revision: 3,
      confirmed: true,
    }, factClock);
    assert.deepEqual(revoked, { id: brief5Fact });

    const resumed = await resumeBatch(db, owner, {
      action: "resume-batch",
      brandId: brand,
      batchId: pausedBatch.batch.id,
      operationId: randomUUID(),
    }, clock);
    assert.equal(resumed.error, undefined);
    const unit4 = resumed.units.find((unit) => unit.briefId === brief4);
    const unit5 = resumed.units.find((unit) => unit.briefId === brief5);
    assert.equal(unit4.status, "succeeded");
    assert.equal(unit5.status, "blocked");
    assert.match(unit5.blockedReason ?? "", /facts_unusable|fact/);
    const brief5Detail = await readBriefDetail(db, owner, brief5);
    assert.equal(brief5Detail.brief.status, "invalidated");
    if (unit4.contentVersionId) {
      const draft = await readContentVersion(db, owner, unit4.contentVersionId);
      assert.equal(draft.version.status, "draft");
    }

    assert.equal((await readBriefDetail(db, outsider, brief1)).error, "NOT_FOUND");
    assert.equal((await readBatch(db, outsider, batch.batch.id)).error, "NOT_FOUND");
    assert.equal(
      (await readContentVersion(db, outsider, successSnapshots[0].contentVersionId)).error,
      "NOT_FOUND",
    );
  });
}
