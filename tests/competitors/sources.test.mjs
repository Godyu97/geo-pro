import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { inspectCitationSource, readCitationSources, readCompetitorWorkspace } from "../../src/features/competitors/commands.ts";
import { supportedClaimRecord, thirdPartySupportSummary } from "../../src/features/source-opportunities/rules.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-20T10:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌",
  description: "Synthetic brand for source inspection",
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
    [id, "Source owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

test("a claim is stored only when the citation supports the brand", () => {
  assert.equal(supportedClaimRecord({
    support: "unknown",
    supportedClaim: "不该保存",
    factVersionId: "11111111-1111-4111-8111-111111111111",
  }).supportedClaim, null);
  assert.equal(supportedClaimRecord({
    support: "does_not_support",
    supportedClaim: "明确不支持",
  }).factVersionId, null);
  assert.equal(supportedClaimRecord({
    support: "supports",
    supportedClaim: "  公开售价 100 元  ",
  }).supportedClaim, "公开售价 100 元");
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: an unreadable citation stays visible with unknown support`, async (t) => {
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
      questionText: "这个品类里该看哪一页？",
      answerText: "回答引用了一个打不开的第三方页面。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [{
        rawUrl: "https://alpha.example.com/restricted",
        citationOrigin: "consumer_visible",
        ownership: "third_party",
        pageStatus: "restricted",
      }, {
        rawUrl: "https://beta.example.com/live",
        citationOrigin: "analyst_found",
        ownership: "unknown",
        pageStatus: "reachable",
      }],
      locatorRef: "fixture://sources/restricted",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "unknown",
      recommended: "unknown",
      officialSiteCited: "unknown",
    }, clock);
    assert.equal(saved.error, undefined);
    const restricted = saved.citations.find((item) => item.rawUrl.includes("alpha.example.com"));
    const live = saved.citations.find((item) => item.rawUrl.includes("beta.example.com"));
    assert.ok(restricted);
    assert.ok(live);

    const before = await readCitationSources(db, owner, brand);
    assert.equal(before.citations.length, 2);
    assert.equal(before.citations.every((item) => item.support === "unknown"), true);
    assert.equal(before.hosts.find((item) => item.host === "alpha.example.com")?.pages, 1);

    const limited = await inspectCitationSource(db, owner, {
      brandId: brand,
      citationId: restricted.id,
      pageLive: true,
      readable: false,
      authorKnown: false,
      supportsBrand: true,
      supportedClaim: "不该保存的主张",
    }, clock);
    assert.equal(limited.error, undefined);
    assert.equal(limited.support, "unknown");
    assert.equal(limited.state, "limited");
    assert.equal(limited.citationKept, true);
    assert.equal(limited.inspection.supportedClaim, null);
    assert.equal(limited.inspection.factVersionId, null);

    const dead = await inspectCitationSource(db, owner, {
      brandId: brand,
      citationId: live.id,
      pageLive: false,
      readable: false,
      authorKnown: false,
      supportsBrand: true,
    }, clock);
    assert.equal(dead.support, "unknown");
    assert.equal(dead.state, "observed");
    assert.equal(dead.citationKept, true);

    const after = await readCitationSources(db, owner, brand);
    assert.equal(after.citations.length, 2);
    assert.equal(after.citations.every((item) => item.support === "unknown"), true);

    const positive = await inspectCitationSource(db, owner, {
      brandId: brand,
      citationId: live.id,
      pageLive: true,
      readable: true,
      authorKnown: true,
      supportsBrand: true,
      supportedClaim: "公开售价 100 元",
    }, clock);
    assert.equal(positive.support, "supports");
    assert.equal(positive.state, "resolved");
    assert.equal(positive.inspection.supportedClaim, "公开售价 100 元");
    assert.equal(positive.inspection.factVersionId, null);
    const shown = await readCitationSources(db, owner, brand);
    assert.equal(shown.citations.find((item) => item.citationId === live.id)?.supportedClaim, "公开售价 100 元");
    assert.equal(shown.citations.find((item) => item.citationId === restricted.id)?.supportedClaim, null);
    const stillThere = await queryWithParameters(db, "SELECT id FROM answer_citation WHERE id = ?", [live.id]);
    assert.equal(stillThere.length, 1);

    const denied = await readCitationSources(db, outsider, brand);
    assert.equal(denied.error, "NOT_FOUND");

    await new PurgeDao(db).clearContents({ ownerId: owner, brandId: brand }, time);
    const left = await queryWithParameters(db, "SELECT id FROM source_inspection WHERE brand_id = ?", [brand]);
    assert.equal(left.length, 0);
  });

  test(`${kind}: third-party support rate counts positive and non-support while keeping unknown and legacy rows out of denominator`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));

    const [owner, owner2, outsider] = await Promise.all([account(db), account(db), account(db)]);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);

    const legacySaved = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "旧复核问题",
      answerText: "旧复核回答引用了一个历史页面。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [{
        rawUrl: "https://legacy.example.com/old-review",
        citationOrigin: "consumer_visible",
        ownership: "third_party",
        pageStatus: "reachable",
      }],
      locatorRef: "fixture://sources/legacy",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "unknown",
      recommended: "unknown",
      officialSiteCited: "unknown",
    }, clock);
    assert.equal(legacySaved.error, undefined);
    const legacyCitation = legacySaved.citations[0];

    // Insert a legacy unknown inspection created before does_not_support existed (supports_brand = 0 -> support = 'unknown')
    await queryWithParameters(
      db,
      `INSERT INTO source_inspection (
        id, brand_id, owner_id, citation_id, state, support, page_live, readable,
        author_known, supports_brand, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'resolved', 'unknown', 1, 1, 1, 0, ?, ?)`,
      [randomUUID(), brand, owner, legacyCitation.id, time, time],
    );

    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const afterMigrate = await readCitationSources(db, owner, brand);
    assert.equal(afterMigrate.citations[0].support, "unknown");
    assert.equal(afterMigrate.citations[0].recorded, true);
    assert.equal(afterMigrate.supportSummary.supportRate, null);
    assert.equal(afterMigrate.supportSummary.judgableCount, 0);
    assert.equal(afterMigrate.supportSummary.unknownCount, 1);
    assert.equal(afterMigrate.supportSummary.unavailableReason, "no_judgable_inspections");

    // Second brand with 4 observed citations: URL-only first -> N/A, then 1 positive, 1 non-support, 2 unreadable -> 1/2
    const brand2 = randomUUID();
    await brands.insertBrand(owner2, brand2, time);
    await brands.insertVersion(brand2, 1, fields, time);
    const fourSaved = await submitManualEvidence(db, owner2, {
      action: "submit-manual",
      brandId: brand2,
      operationId: randomUUID(),
      questionText: "哪四条第三方来源？",
      answerText: "回答带了四条观察引用。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [
        { rawUrl: "https://one.example.com/pos", citationOrigin: "consumer_visible", ownership: "third_party", pageStatus: "reachable" },
        { rawUrl: "https://two.example.com/neg", citationOrigin: "consumer_visible", ownership: "third_party", pageStatus: "reachable" },
        { rawUrl: "https://three.example.com/lim1", citationOrigin: "consumer_visible", ownership: "third_party", pageStatus: "restricted" },
        { rawUrl: "https://four.example.com/lim2", citationOrigin: "consumer_visible", ownership: "unknown", pageStatus: "restricted" },
      ],
      locatorRef: "fixture://sources/four",
      collectorId: owner2,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "unknown",
      recommended: "unknown",
      officialSiteCited: "unknown",
    }, clock);
    assert.equal(fourSaved.error, undefined);
    const [cPos, cNeg, cLim1, cLim2] = fourSaved.citations;

    const urlOnly = await readCompetitorWorkspace(db, owner2, brand2);
    assert.equal("error" in urlOnly, false);
    if (!("error" in urlOnly)) {
      assert.equal(urlOnly.supportSummary.supportRate, null);
      assert.equal(urlOnly.supportSummary.unavailableReason, "uninspected_only");
      assert.equal(urlOnly.supportSummary.judgableCount, 0);
      assert.equal(urlOnly.supportSummary.unknownCount, 4);
      assert.equal(urlOnly.supportSummary.uninspectedCount, 4);
    }

    const pos = await inspectCitationSource(db, owner2, {
      brandId: brand2, citationId: cPos.id, pageLive: true, readable: true, authorKnown: true, supportsBrand: true,
    }, clock);
    assert.equal(pos.support, "supports");
    assert.equal(pos.state, "resolved");

    const neg = await inspectCitationSource(db, owner2, {
      brandId: brand2, citationId: cNeg.id, pageLive: true, readable: true, authorKnown: true, supportsBrand: false,
    }, clock);
    assert.equal(neg.support, "does_not_support");
    assert.equal(neg.state, "resolved");

    const lim1 = await inspectCitationSource(db, owner2, {
      brandId: brand2, citationId: cLim1.id, pageLive: true, readable: false, authorKnown: true, supportsBrand: false,
    }, clock);
    assert.equal(lim1.support, "unknown");
    assert.equal(lim1.state, "limited");

    const lim2 = await inspectCitationSource(db, owner2, {
      brandId: brand2, citationId: cLim2.id, pageLive: true, readable: false, authorKnown: false, supportsBrand: true,
    }, clock);
    assert.equal(lim2.support, "unknown");
    assert.equal(lim2.state, "limited");

    const ws = await readCompetitorWorkspace(db, owner2, brand2);
    assert.equal("error" in ws, false);
    if (!("error" in ws)) {
      assert.equal(ws.citations.length, 4);
      assert.equal(ws.supportSummary.supportsCount, 1);
      assert.equal(ws.supportSummary.doesNotSupportCount, 1);
      assert.equal(ws.supportSummary.judgableCount, 2);
      assert.equal(ws.supportSummary.unknownCount, 2);
      assert.equal(ws.supportSummary.limitedCount, 2);
      assert.equal(ws.supportSummary.supportRate, 0.5);
      assert.equal(ws.supportSummary.unavailableReason, null);
    }

    // Unknown authorship stays unknown even if supportsBrand is checked, and outsider is refused
    const unknownAuth = await inspectCitationSource(db, owner2, {
      brandId: brand2, citationId: cLim2.id, pageLive: true, readable: true, authorKnown: false, supportsBrand: true,
    }, clock);
    assert.equal(unknownAuth.support, "unknown");
    assert.equal(unknownAuth.state, "unknown");

    const outsiderDenied = await inspectCitationSource(db, outsider, {
      brandId: brand2, citationId: cNeg.id, pageLive: true, readable: true, authorKnown: true, supportsBrand: false,
    }, clock);
    assert.equal(outsiderDenied.error, "NOT_FOUND");
  });

  test(`${kind}: old inspections and briefs stay unchanged when claim and handoff columns are added`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    const owner = await account(db);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);
    const saved = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "升级前的引用",
      answerText: "升级前已经保存的引用。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [{
        rawUrl: "https://legacy.example.com/kept",
        citationOrigin: "consumer_visible",
        ownership: "third_party",
        pageStatus: "reachable",
      }],
      locatorRef: "fixture://sources/upgrade",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "unknown",
      recommended: "unknown",
      officialSiteCited: "unknown",
    }, clock);
    assert.equal(saved.error, undefined);
    const citationId = saved.citations[0].id;
    const inspectionId = randomUUID();
    const briefId = randomUUID();
    await queryWithParameters(db, `INSERT INTO source_inspection (
      id, brand_id, owner_id, citation_id, state, support, page_live, readable,
      author_known, supports_brand, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'limited', 'unknown', 1, 0, 0, 0, ?, ?)`,
    [inspectionId, brand, owner, citationId, time, time]);
    await queryWithParameters(db, `INSERT INTO research_brief (
      id, brand_id, owner_id, question_cluster, gap, facts_json, source_ids_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, '升级前问题簇', '升级前缺口', '[]', ?, 'proposed', ?, ?)`,
    [briefId, brand, owner, JSON.stringify([citationId]), time, time]);

    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const [inspection] = await queryWithParameters(db, `SELECT state, support, supported_claim AS "supportedClaim",
      fact_version_id AS "factVersionId" FROM source_inspection WHERE id = ?`, [inspectionId]);
    assert.equal(inspection.state, "limited");
    assert.equal(inspection.support, "unknown");
    assert.equal(inspection.supportedClaim, null);
    assert.equal(inspection.factVersionId, null);
    const [brief] = await queryWithParameters(db, `SELECT status, gap, content_brief_id AS "contentBriefId",
      optimization_task_id AS "optimizationTaskId" FROM research_brief WHERE id = ?`, [briefId]);
    assert.equal(brief.status, "proposed");
    assert.equal(brief.gap, "升级前缺口");
    assert.equal(brief.contentBriefId, null);
    assert.equal(brief.optimizationTaskId, null);
  });
}

test("thirdPartySupportSummary handles empty, uninspected, and mixed citations", () => {
  const empty = thirdPartySupportSummary([]);
  assert.equal(empty.supportRate, null);
  assert.equal(empty.unavailableReason, "no_citations");
  const mixed = thirdPartySupportSummary([
    { state: "resolved", support: "supports", recorded: true },
    { state: "resolved", support: "does_not_support", recorded: true },
    { state: "limited", support: "unknown", recorded: true },
    { state: "observed", support: "unknown", recorded: false },
  ]);
  assert.equal(mixed.supportsCount, 1);
  assert.equal(mixed.doesNotSupportCount, 1);
  assert.equal(mixed.judgableCount, 2);
  assert.equal(mixed.unknownCount, 2);
  assert.equal(mixed.uninspectedCount, 1);
  assert.equal(mixed.limitedCount, 1);
  assert.equal(mixed.supportRate, 0.5);
});
