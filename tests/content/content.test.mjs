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
  listBriefs,
  pauseBatch,
  readBatch,
  readBriefDetail,
  readContentVersion,
  readPlan,
  resumeBatch,
  retryFailed,
  saveBriefDraft,
} from "../../src/features/content/commands.ts";
import {
  ContentDao,
  clusterPublicationsQuery,
  latestBriefVersionsBatchQuery,
  ownedPageCitationsQuery,
} from "../../src/features/content/dao.ts";
import {
  buildClusterPlanViews,
  contentBriefGaps,
  coverageFromCluster,
  fillDraftFromTemplate,
  normalizePlanPageUrl,
} from "../../src/features/content/rules.ts";
import { grantBrandMember } from "../../src/features/team-access/commands.ts";
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

test("pure: cluster plan view distinguishes confirmed existing, planned, unverified legacy, update, and gap briefs", () => {
  assert.equal(
    normalizePlanPageUrl("HTTPS://Bing.Example.COM:443/pricing/?utm_source=ai#top"),
    "https://bing.example.com/pricing",
  );
  const existingUrl = "https://bing.example.com/pricing";
  const plannedUrl = "https://bing.example.com/new-guide";
  const legacyUrl = "https://bing.example.com/legacy-unverified";
  const views = buildClusterPlanViews({
    plans: [
      {
        id: "plan-1",
        questionCluster: "选购价格",
        coverageJson: JSON.stringify(coverageFromCluster({
          questionCluster: "选购价格",
          existingPages: [existingUrl, legacyUrl],
          pendingPages: [],
          gapPages: [],
        })),
        updatedAt: time,
      },
    ],
    briefs: [
      {
        id: "brief-update",
        planId: "plan-1",
        status: "confirmed",
        title: "更新价格页",
        primaryPage: `${existingUrl}/`,
        gaps: [],
      },
      {
        id: "brief-gap",
        planId: "plan-1",
        status: "draft",
        title: "缺主页面 Brief",
        primaryPage: "",
        gaps: [{ code: "primaryPageMissing" }],
      },
      {
        id: "brief-planned",
        planId: "plan-1",
        status: "draft",
        title: "待发布计划 Brief",
        primaryPage: plannedUrl,
        gaps: [{ code: "sourceMissing" }, { code: "factsMissing" }],
      },
    ],
    ownedCitations: [
      {
        id: "cit-1",
        observationId: "obs-1",
        rawUrl: existingUrl,
        normalizedUrl: existingUrl,
        ownership: "owned_domain",
      },
    ],
    publications: [],
  });
  assert.equal(views.length, 1);
  const [view] = views;
  assert.equal(view.existingPages.length, 1);
  assert.equal(view.existingPages[0].url, existingUrl);
  assert.equal(view.existingPages[0].evidence[0].kind, "citation_ownership");
  assert.equal(view.existingPages[0].linkedBriefs[0].briefId, "brief-update");
  assert.equal(view.plannedPages.length, 1);
  assert.equal(view.plannedPages[0].url, plannedUrl);
  assert.equal(view.plannedPages[0].kind, "planned");
  assert.equal(view.unverifiedPages.length, 1);
  assert.equal(view.unverifiedPages[0].url, legacyUrl);
  assert.equal(view.unverifiedPages[0].kind, "needs_verification");
  assert.equal(view.pendingUpdates.map((item) => item.briefId).join(","), "brief-update");
  assert.equal(view.gaps.map((item) => item.briefId).join(","), "brief-gap,brief-planned");
});

function traceQueries(db) {
  const queries = [];
  return {
    queries,
    connection: {
      kind: db.kind,
      query(sql, values) {
        queries.push({ sql, values });
        return db.query(sql, values);
      },
      transaction(fn) {
        return db.transaction(fn);
      },
    },
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: cluster plan view preserves existing basis, update/gap briefs, idempotent saves, cross-brand isolation, and batch queries`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;

    const [ownerA, ownerB] = await Promise.all([account(db), account(db)]);
    const brandA = randomUUID();
    const brandB = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(ownerA, brandA, time);
    await brands.insertVersion(brandA, 1, fields, time);
    await brands.insertBrand(ownerB, brandB, time);
    await brands.insertVersion(brandB, 1, { ...fields, name: "丁品牌", website: "https://ding.example.com" }, time);

    const factA = await approveFact(db, ownerA, brandA, "Synthetic 100 CNY");
    const factB = await approveFact(db, ownerB, brandB, "Synthetic 200 CNY");
    const existingUrl = "https://bing.example.com/pricing";
    const plannedUrl = "https://bing.example.com/new-guide";
    const legacyUrl = "https://bing.example.com/legacy-page";
    const otherBrandUrl = "https://ding.example.com/secret-page";
    const clusterName = "选购价格簇";
    const legacyCluster = "历史待核对簇";
    const plannedCluster = "待发布计划簇";

    const obsId = randomUUID();
    const citId = randomUUID();
    const fp = "a".repeat(64);
    await queryWithParameters(
      db,
      `INSERT INTO answer_observation (
        id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method,
        question_text, answer_text, fingerprint, captured_at, region, language,
        requested_network_mode, entity_version, citation_set_state, evidence_state,
        created_at, target_region
      ) VALUES (?, ?, ?, NULL, NULL, 'consumer_ui', 'manual', ?, ?, ?, ?, 'CN', 'zh-CN', 'unknown', 1, 'complete', 'complete', ?, 'CN')`,
      [obsId, brandA, ownerA, "价格怎么选", "可参考官方定价页。", fp, time, time],
    );
    await queryWithParameters(
      db,
      `INSERT INTO answer_citation (
        id, observation_id, brand_id, raw_url, normalized_url, citation_origin,
        position_label, ownership, page_status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'consumer_visible', '1', 'owned_domain', 'reachable', ?)`,
      [citId, obsId, brandA, existingUrl, existingUrl, time],
    );

    const updateSaved = await saveBriefDraft(db, ownerA, {
      action: "save-brief-draft",
      brandId: brandA,
      operationId: randomUUID(),
      questionCluster: clusterName,
      fields: completeFields([factA], {
        primaryPage: `${existingUrl}/`,
        titleCandidates: ["更新现有定价页"],
      }),
    }, clock);
    assert.equal(updateSaved.error, undefined);
    const confirmed = await confirmBrief(db, ownerA, {
      action: "confirm-brief",
      brandId: brandA,
      briefId: updateSaved.briefId,
      operationId: randomUUID(),
    }, clock);
    assert.equal(confirmed.error, undefined);

    const gapSaved = await saveBriefDraft(db, ownerA, {
      action: "save-brief-draft",
      brandId: brandA,
      operationId: randomUUID(),
      questionCluster: clusterName,
      fields: completeFields([factA], {
        primaryPage: "",
        titleCandidates: ["缺主页面待补齐"],
      }),
    }, clock);
    assert.equal(gapSaved.error, undefined);

    // Repeat save of the gap brief (without questionCluster, as in brief-page edit) preserves update brief & avoids duplicates.
    const repeatSave = await saveBriefDraft(db, ownerA, {
      action: "save-brief-draft",
      brandId: brandA,
      operationId: randomUUID(),
      briefId: gapSaved.briefId,
      fields: completeFields([factA], {
        primaryPage: "",
        titleCandidates: ["缺主页面待补齐"],
        targetGap: "补充具体承接页",
      }),
    }, clock);
    assert.equal(repeatSave.error, undefined);
    assert.equal(repeatSave.planId, updateSaved.planId);

    // Planned-only cluster + missing-evidence brief gate check.
    const plannedSaved = await saveBriefDraft(db, ownerA, {
      action: "save-brief-draft",
      brandId: brandA,
      operationId: randomUUID(),
      questionCluster: plannedCluster,
      fields: completeFields([], {
        primaryPage: plannedUrl,
        applicableBoundary: "",
        titleCandidates: ["待发布计划页"],
      }),
    }, clock);
    assert.equal(plannedSaved.error, undefined);
    const gateBlocked = await confirmBrief(db, ownerA, {
      action: "confirm-brief",
      brandId: brandA,
      briefId: plannedSaved.briefId,
      operationId: randomUUID(),
    }, clock);
    assert.equal(gateBlocked.error, "EVIDENCE_REQUIRED");

    // Historical content_plan record lacking ownership/publication basis.
    await new ContentDao(db).insertPlan({
      id: randomUUID(),
      brandId: brandA,
      ownerId: ownerA,
      questionCluster: legacyCluster,
      coverageJson: JSON.stringify(coverageFromCluster({
        questionCluster: legacyCluster,
        existingPages: [legacyUrl],
        pendingPages: [],
        gapPages: [],
      })),
      createdAt: time,
      updatedAt: time,
    });

    // Other brand with same question cluster name must never leak into brandA.
    const otherSaved = await saveBriefDraft(db, ownerB, {
      action: "save-brief-draft",
      brandId: brandB,
      operationId: randomUUID(),
      questionCluster: clusterName,
      fields: completeFields([factB], {
        primaryPage: otherBrandUrl,
        titleCandidates: ["丁品牌隐私计划"],
      }),
    }, clock);
    assert.equal(otherSaved.error, undefined);

    const listTwo = traceQueries(db);
    const listed = await listBriefs(listTwo.connection, ownerA, brandA, 50, time);
    assert.equal("error" in listed, false);
    assert.equal(JSON.stringify(listed).includes(otherBrandUrl), false);
    assert.equal(JSON.stringify(listed).includes("丁品牌隐私计划"), false);

    const clusterView = listed.clusterPlans.find((item) => item.questionCluster === clusterName);
    assert.ok(clusterView);
    assert.equal(clusterView.existingPages.length, 1);
    assert.equal(clusterView.existingPages[0].url, existingUrl);
    assert.equal(clusterView.existingPages[0].evidence[0].kind, "citation_ownership");
    assert.equal(clusterView.existingPages[0].evidence[0].observationId, obsId);
    assert.equal(clusterView.pendingUpdates.length, 1);
    assert.equal(clusterView.pendingUpdates[0].briefId, updateSaved.briefId);
    assert.equal(clusterView.pendingUpdates[0].status, "confirmed");
    assert.equal(clusterView.pendingUpdates[0].targetsExisting, true);
    assert.equal(clusterView.gaps.length, 1);
    assert.equal(clusterView.gaps[0].briefId, gapSaved.briefId);
    assert.equal(clusterView.gaps[0].status, "draft");
    assert.ok(clusterView.gaps[0].gaps.some((gap) => gap.code === "primaryPageMissing"));

    const persistedPlan = await readPlan(db, ownerA, brandA, updateSaved.planId);
    assert.equal("error" in persistedPlan, false);
    const parsedCoverage = JSON.parse(persistedPlan.plan.coverageJson);
    assert.deepEqual(parsedCoverage.existing, [existingUrl]);
    assert.deepEqual(parsedCoverage.pendingUpdate, []);

    await grantBrandMember(db, ownerA, { userId: ownerB, brandId: brandA, role: "read_only", expiresAt: null }, time);
    const readOnlyPlan = await readPlan(db, ownerB, brandA, updateSaved.planId);
    const readOnlyList = await listBriefs(db, ownerB, brandA, 50, time);
    assert.equal(readOnlyPlan.plan.id, updateSaved.planId);
    assert.ok(readOnlyList.clusterPlans.some((item) => item.questionCluster === clusterName));
    for (const result of [readOnlyPlan, readOnlyList]) {
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes(citId), false);
      assert.equal(serialized.includes(obsId), false);
      assert.equal(serialized.includes("citation_ownership"), false);
    }
    assert.equal(parsedCoverage.gaps.length, 1);

    const plannedView = listed.clusterPlans.find((item) => item.questionCluster === plannedCluster);
    assert.ok(plannedView);
    assert.equal(plannedView.existingPages.length, 0);
    assert.equal(plannedView.plannedPages.length, 1);
    assert.equal(plannedView.plannedPages[0].url, plannedUrl);
    assert.equal(plannedView.plannedPages[0].kind, "planned");

    const legacyView = listed.clusterPlans.find((item) => item.questionCluster === legacyCluster);
    assert.ok(legacyView);
    assert.equal(legacyView.existingPages.length, 0);
    assert.equal(legacyView.unverifiedPages.length, 1);
    assert.equal(legacyView.unverifiedPages[0].url, legacyUrl);
    assert.equal(legacyView.unverifiedPages[0].kind, "needs_verification");

    // Batch query count stays constant regardless of brief count (no N+1).
    for (let i = 0; i < 10; i += 1) {
      await saveBriefDraft(db, ownerA, {
        action: "save-brief-draft",
        brandId: brandA,
        operationId: randomUUID(),
        questionCluster: clusterName,
        fields: completeFields([factA], {
          primaryPage: existingUrl,
          titleCandidates: [`批量测试-${i}`],
        }),
      }, clock);
    }
    const listMany = traceQueries(db);
    const listedMany = await listBriefs(listMany.connection, ownerA, brandA, 50, time);
    assert.equal("error" in listedMany, false);
    assert.equal(listMany.queries.length, listTwo.queries.length);

    if (kind === "postgresql") {
      await db.query("ANALYZE content_brief, content_brief_version, content_plan, content_publication, answer_citation, answer_observation");
    }
    const explainSql = (spec) => (
      kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${spec.sql}`, spec.values);
        })
        : queryWithParameters(db, `EXPLAIN QUERY PLAN ${spec.sql}`, spec.values)
    );
    const batchPlan = JSON.stringify(await explainSql(latestBriefVersionsBatchQuery(brandA, [updateSaved.briefId, gapSaved.briefId])));
    const citationsPlan = JSON.stringify(await explainSql(ownedPageCitationsQuery(ownerA, brandA, 200)));
    const pubsPlan = JSON.stringify(await explainSql(clusterPublicationsQuery(ownerA, brandA, 200)));
    assert.match(batchPlan, /content_brief_version_rev_uidx|content_brief_version_brand_idx|sqlite_autoindex/);
    assert.match(citationsPlan, /answer_observation_(owner_idx|brand_idx)|answer_citation_(brand_idx|observation_idx)/);
    assert.match(pubsPlan, /content_publication_(brand_idx|owner_idx)/);
  });
}
