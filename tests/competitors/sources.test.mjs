import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { inspectCitationSource, readCitationSources } from "../../src/features/competitors/commands.ts";
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
}
