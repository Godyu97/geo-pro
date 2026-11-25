import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { inspectCitationSource, readCitationSources, readCompetitorWorkspace } from "../../src/features/competitors/commands.ts";
import { thirdPartySupportSummary } from "../../src/features/source-opportunities/rules.ts";
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
    }, clock);
    assert.equal(limited.error, undefined);
    assert.equal(limited.support, "unknown");
    assert.equal(limited.state, "limited");
    assert.equal(limited.citationKept, true);

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
    }, clock);
    assert.equal(positive.support, "supports");
    assert.equal(positive.state, "resolved");
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
