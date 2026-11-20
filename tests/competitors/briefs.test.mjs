import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { proposeResearchBrief, setResearchBriefStatus } from "../../src/features/competitors/commands.ts";
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
    async transaction(work) {
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
}
