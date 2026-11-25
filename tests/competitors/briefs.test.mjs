import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { competitorErrors } from "../../src/features/competitors/contracts.ts";
import {
  createContentBriefFromResearch,
  createOptimizationTaskFromResearch,
  proposeResearchBrief,
  setResearchBriefStatus,
} from "../../src/features/competitors/commands.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-20T10:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌",
  description: "Synthetic brand for research briefs",
  website: "https://yi.example.com",
  aliases: ["乙"],
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

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Brief owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

test("a brief that only swaps the brand name is refused before it is stored", async () => {
  const refused = await proposeResearchBrief({
    async transaction() {
      throw new Error("copied brief must not touch the database");
    },
  }, "owner", {
    brandId: randomUUID(),
    questionCluster: "怎么选",
    gap: "交付周期没有写清",
    facts: ["交付周期以合同为准"],
    sourceIds: [randomUUID()],
    sourceText: "甲品牌更适合采购",
    briefText: "乙品牌更适合采购",
    sourceBrand: "甲品牌",
    ownBrand: "乙品牌",
  }, clock);
  assert.equal(refused.error, "INVALID_INPUT");
  assert.equal(refused.reason, "copied_replacement");
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: a brief keeps its sources and does not store a brand-swap copy`, async (t) => {
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
    const saved = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "采购时怎么比较？",
      answerText: "回答提到了甲品牌的页面。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "partial",
      citations: [{
        rawUrl: "https://alpha.example.com/compare",
        citationOrigin: "consumer_visible",
        ownership: "competitor",
        pageStatus: "reachable",
      }],
      locatorRef: "fixture://briefs/compare",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "false",
      recommended: "unknown",
      officialSiteCited: "unknown",
    }, clock);
    assert.equal(saved.error, undefined);
    const sourceId = saved.citations[0].id;

    const copied = await proposeResearchBrief(db, owner, {
      brandId: brand,
      questionCluster: "采购比较",
      gap: "交付周期没有写清",
      facts: ["交付周期以合同为准"],
      sourceIds: [sourceId],
      sourceText: "甲品牌更适合采购",
      briefText: "乙品牌更适合采购",
      sourceBrand: "甲品牌",
      ownBrand: "乙品牌",
    }, clock);
    assert.equal(copied.reason, "copied_replacement");
    const none = await queryWithParameters(db, "SELECT id FROM research_brief WHERE brand_id = ?", [brand]);
    assert.equal(none.length, 0);

    const proposed = await proposeResearchBrief(db, owner, {
      brandId: brand,
      questionCluster: "采购比较",
      gap: "交付周期没有写清",
      facts: ["交付周期以合同为准"],
      sourceIds: [sourceId],
      sourceText: "甲品牌更适合采购",
      briefText: "单独写清交付周期，不沿用对方原句。",
      sourceBrand: "甲品牌",
      ownBrand: "乙品牌",
    }, clock);
    assert.equal(proposed.error, undefined);
    assert.equal(proposed.brief.copiedReplacement, false);
    assert.deepEqual(proposed.brief.sourceIds, [sourceId]);
    assert.equal(proposed.brief.status, "proposed");

    const accepted = await setResearchBriefStatus(db, owner, {
      brandId: brand,
      briefId: proposed.brief.id,
      status: "accepted",
    }, clock);
    assert.equal(accepted.status, "accepted");
    const again = await setResearchBriefStatus(db, owner, {
      brandId: brand,
      briefId: proposed.brief.id,
      status: "dismissed",
    }, clock);
    assert.equal(again.error, "OPERATION_CONFLICT");

    const missing = await proposeResearchBrief(db, owner, {
      brandId: brand,
      questionCluster: "采购比较",
      gap: "还缺一个真实来源",
      facts: [],
      sourceIds: [randomUUID()],
      sourceText: "原文",
      briefText: "另一条角度",
      sourceBrand: "甲品牌",
      ownBrand: "乙品牌",
    }, clock);
    assert.equal(missing.reason, "missing_evidence");

    const denied = await proposeResearchBrief(db, outsider, {
      brandId: brand,
      questionCluster: "采购比较",
      gap: "别人的品牌",
      facts: ["不该写入"],
      sourceIds: [sourceId],
      sourceText: "原文",
      briefText: "另一条角度",
      sourceBrand: "甲品牌",
      ownBrand: "乙品牌",
    }, clock);
    assert.equal(denied.error, "NOT_FOUND");

    await new PurgeDao(db).clearContents({ ownerId: owner, brandId: brand }, time);
    const left = await queryWithParameters(db, "SELECT id FROM research_brief WHERE brand_id = ?", [brand]);
    assert.equal(left.length, 0);
  });

  test(`${kind}: an accepted brief becomes one draft and one deduped task`, async (t) => {
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
    const factId = randomUUID();
    const scope = { ownerId: owner, brandId: brand };
    const factClock = () => new Date(time);
    const fact = {
      ...emptyFields,
      category: "specification",
      title: "交付周期",
      claim: "交付周期以合同为准",
      sourceType: "internal",
      sourceReference: "INTERNAL-ATTACHMENT-TOKEN",
      sourceLocator: "合同页",
      sourceExcerpt: "公开摘录，不含对方文案。",
      sourceDate: "2026-11-18",
      permission: "public",
      validity: "dated",
      validThrough: "2026-12-31",
    };
    const runFact = (command) => executeFactCommand(db, scope, command, factClock);
    assert.deepEqual(await runFact({ action: "create", id: factId, previousId: null, fields: fact }), { id: factId });
    assert.deepEqual(await runFact({ action: "submit", id: factId, revision: 1 }), { id: factId });
    assert.deepEqual(await runFact({
      action: "approve", id: factId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
    }), { id: factId });

    const saved = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "采购时怎么比较？",
      answerText: "甲品牌更适合采购，这句不能进入内容草稿。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "partial",
      citations: [{
        rawUrl: "https://alpha.example.com/compare",
        citationOrigin: "consumer_visible",
        ownership: "competitor",
        pageStatus: "reachable",
      }],
      locatorRef: "fixture://briefs/handoff",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "false",
      recommended: "unknown",
      officialSiteCited: "unknown",
    }, clock);
    assert.equal(saved.error, undefined);
    const sourceId = saved.citations[0].id;
    const [citation] = await queryWithParameters(
      db, `SELECT normalized_url AS "normalizedUrl" FROM answer_citation WHERE id = ?`, [sourceId],
    );
    const proposed = await proposeResearchBrief(db, owner, {
      brandId: brand,
      questionCluster: "采购比较",
      gap: "交付周期没有写清",
      facts: ["交付周期以合同为准"],
      sourceIds: [sourceId],
      sourceText: "甲品牌更适合采购",
      briefText: "单独写清交付周期，不沿用对方原句。",
      sourceBrand: "甲品牌",
      ownBrand: "乙品牌",
    }, clock);
    assert.equal(proposed.error, undefined);
    const pending = await createContentBriefFromResearch(db, owner, { brandId: brand, briefId: proposed.brief.id }, clock);
    assert.equal(pending.error, "OPERATION_CONFLICT");

    await setResearchBriefStatus(db, owner, { brandId: brand, briefId: proposed.brief.id, status: "accepted" }, clock);
    const first = await createContentBriefFromResearch(db, owner, { brandId: brand, briefId: proposed.brief.id }, clock);
    const second = await createContentBriefFromResearch(db, owner, { brandId: brand, briefId: proposed.brief.id }, clock);
    assert.equal(first.error, undefined);
    assert.equal(first.created, true);
    assert.equal(first.status, "draft");
    assert.equal(second.created, false);
    assert.equal(second.contentBriefId, first.contentBriefId);
    assert.equal(first.competitorSource, citation.normalizedUrl);
    assert.equal(first.competitorSource.includes("甲品牌更适合采购"), false);
    assert.deepEqual(first.factVersionIds, [factId]);
    const [draft] = await queryWithParameters(db, `SELECT b.status, v.confirmed_at AS "confirmedAt", v.target_gap AS "targetGap",
      v.competitor_source AS "competitorSource"
      FROM content_brief b JOIN content_brief_version v ON v.brief_id = b.id WHERE b.id = ?`, [first.contentBriefId]);
    assert.equal(draft.status, "draft");
    assert.equal(draft.confirmedAt, null);
    assert.equal(draft.targetGap, "交付周期没有写清");
    assert.equal(draft.competitorSource, citation.normalizedUrl);
    const briefCount = await queryWithParameters(db, `SELECT id FROM content_brief WHERE brand_id = ?`, [brand]);
    assert.equal(briefCount.length, 1);

    const denied = await createContentBriefFromResearch(db, outsider, { brandId: brand, briefId: proposed.brief.id }, clock);
    assert.equal(denied.error, "NOT_FOUND");
    assert.equal(competitorErrors.NOT_FOUND, 404);
    const task = await createOptimizationTaskFromResearch(db, owner, { brandId: brand, briefId: proposed.brief.id }, clock);
    const taskAgain = await createOptimizationTaskFromResearch(db, owner, { brandId: brand, briefId: proposed.brief.id }, clock);
    assert.equal(task.error, undefined);
    assert.equal(task.created, true);
    assert.equal(taskAgain.created, false);
    assert.equal(taskAgain.taskId, task.taskId);
    const [stored] = await queryWithParameters(db, `SELECT t.title, f.problem_statement AS "problemStatement",
      f.evidence_summary AS "evidenceSummary"
      FROM optimization_task t JOIN optimization_finding f ON f.id = t.primary_finding_id WHERE t.id = ?`, [task.taskId]);
    assert.equal(stored.title, "交付周期没有写清");
    assert.equal(stored.problemStatement, "交付周期没有写清");
    assert.equal(stored.evidenceSummary.includes(citation.normalizedUrl), true);
    assert.equal(stored.evidenceSummary.includes("甲品牌更适合采购"), false);
    const taskCount = await queryWithParameters(db, `SELECT id FROM optimization_task WHERE brand_id = ?`, [brand]);
    assert.equal(taskCount.length, 1);
    const outsiderTask = await createOptimizationTaskFromResearch(db, outsider, {
      brandId: brand, briefId: proposed.brief.id,
    }, clock);
    assert.equal(outsiderTask.error, "NOT_FOUND");

    const explainSql = kind === "sqlite"
      ? `EXPLAIN QUERY PLAN SELECT id FROM research_brief WHERE id = ? AND brand_id = ? AND owner_id = ?`
      : `EXPLAIN SELECT id FROM research_brief WHERE id = ? AND brand_id = ? AND owner_id = ?`;
    const plan = await queryWithParameters(db, explainSql, [proposed.brief.id, brand, owner]);
    assert.ok(plan.length > 0);
    const planText = JSON.stringify(plan);
    assert.equal(planText.toLowerCase().includes("research_brief"), true);
  });
}
