import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { classifyCrawler } from "../../src/features/data-connections/crawler-identity.ts";
import { listCrawlerVisits, readCrawlerVisit, registerCrawlerVisit } from "../../src/features/data-connections/crawler-commands.ts";
import { registerCrawlerVisitSchema } from "../../src/features/data-connections/crawler-contracts.ts";
import { CrawlerObservationDao, crawlerObservationsForOwnerQuery } from "../../src/features/data-connections/crawler-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
const forbiddenCopy = /收录|推荐|排名|inclusion|recommend|ranking/i;

test("classifyCrawler keeps a claim unverified and never marks an inclusion", () => {
  const claimed = classifyCrawler({ userAgentClaimsAi: true, identityVerified: false, answerCitations: 0 });
  assert.equal(claimed.identity, "unverified");
  assert.equal(claimed.calledIncluded, false);
  assert.equal(claimed.citations, 0);
  const verified = classifyCrawler({ userAgentClaimsAi: true, identityVerified: true, answerCitations: 4 });
  assert.equal(verified.identity, "verified");
  assert.equal(verified.calledIncluded, false);
  assert.equal(verified.citations, 4);
  const cited = classifyCrawler({ userAgentClaimsAi: true, identityVerified: false, answerCitations: 9 });
  assert.equal(cited.identity, "unverified");
  assert.equal(cited.citations, 9);
  const input = {
    brandId,
    userAgentClaimsAi: true,
    identityVerified: false,
    answerCitations: 0,
  };
  assert.equal(registerCrawlerVisitSchema.safeParse({ ...input, userAgent: "GPTBot/1.0" }).success, false);
  assert.equal(registerCrawlerVisitSchema.safeParse({ ...input, calledIncluded: true }).success, false);
  assert.equal(registerCrawlerVisitSchema.safeParse({ ...input, answerCitations: -1 }).success, false);
  assert.equal(safeReturnTo("/dashboard/reports/crawler-visits"), "/dashboard/reports/crawler-visits");
});

test("crawler visit copy names an unverified visit and avoids an inclusion claim", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.crawlerVisits.description, /未核验访问/);
  assert.match(zhCN.crawlerVisits.description, /已核验访问/);
  assert.match(zhCN.crawlerVisits.identityUnverified, /未核验访问/);
  assert.match(zhCN.crawlerVisits.identityVerified, /已核验访问/);
  assert.equal(forbiddenCopy.test(JSON.stringify(zhCN.crawlerVisits)), false);
  assert.match(en.crawlerVisits.description, /unverified visit/i);
  assert.match(en.crawlerVisits.description, /verified visit/i);
  assert.match(en.crawlerVisits.identityUnverified, /unverified visit/i);
  assert.match(en.crawlerVisits.identityVerified, /verified visit/i);
  assert.equal(forbiddenCopy.test(JSON.stringify(en.crawlerVisits)), false);
  assert.equal(zhCN.reports.openCrawlerVisits.length > 0, true);
  assert.equal(en.reports.openCrawlerVisits.length > 0, true);
  const page = await readFile(new URL("../../src/features/data-connections/crawler-page.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../../src/features/data-connections/crawler-panel.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("description") && page.includes("fixtureNote"), true);
  assert.equal(panel.includes("identityUnverified") && panel.includes("identityVerified"), true);
  assert.equal(forbiddenCopy.test(panel), false);
  const source = await readFile(new URL("../../src/features/data-connections/crawler-commands.ts", import.meta.url), "utf8");
  assert.equal(source.includes("classifyCrawler"), true);
  assert.equal(/\bfetch\s*\(|\bundici\b|net\.request|https?:\/\//.test(source), false);
});

function watch(db) {
  const captured = [];
  const wrap = (target) => ({
    kind: target.kind,
    query(sql, values) {
      captured.push({ sql, values });
      return target.query(sql, values);
    },
    transaction: target.transaction
      ? (work) => target.transaction((tx) => work(wrap(tx)))
      : undefined,
    savepoint: target.savepoint
      ? (work) => target.savepoint((inner) => work(wrap(inner)))
      : undefined,
  });
  return { captured, connection: wrap(db) };
}

function clockFrom(start) {
  let step = 0;
  return () => new Date(Date.parse(start) + step++ * 60_000).toISOString();
}

function isSelect(sql, table) {
  return /^\s*select/i.test(sql) && new RegExp(`\\b${table}\\b`, "i").test(sql);
}

function writes(captured) {
  return captured.filter((item) => /^\s*(insert|update|delete)/i.test(item.sql));
}

function storedColumns(shape) {
  if (Array.isArray(shape)) {
    return shape
      .filter((row) => row.tbl_name === "crawler_observation")
      .map((row) => row.sql ?? "")
      .join("\n")
      .toLowerCase();
  }
  return shape.columns
    .filter((row) => row.table_name === "crawler_observation")
    .map((row) => row.column_name)
    .join(",")
    .toLowerCase();
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Crawler owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function visit(brand, overrides = {}) {
  return {
    brandId: brand,
    userAgentClaimsAi: true,
    identityVerified: false,
    answerCitations: 0,
    ...overrides,
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: unverified and verified crawler visits stay unincluded`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        assert.match(defined, /crawler_observation_owner_idx/);
        assert.match(defined, /crawler_observation_state_check/);
        assert.match(defined, /unverified/);
        assert.match(defined, /verified/);
        if (db.kind === "postgresql") assert.match(defined, /crawler_observation_brand_id_brand_id_fk/);
        else assert.match(defined, /FOREIGN KEY \(`brand_id`\) REFERENCES `brand`/);
        const columns = storedColumns(migrated);
        for (const word of ["user_agent", "useragent", "password", "token", "secret", "cookie", "body", "ranking", "recommended", "inclusion"]) {
          assert.equal(columns.includes(word), false, word);
        }
        assert.equal(columns.includes("citations"), true);
        assert.equal(columns.includes("called_included"), true);

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom(time);

        const hiddenWatch = watch(db);
        const hidden = await registerCrawlerVisit(hiddenWatch.connection, outsider, visit(brand), clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(writes(hiddenWatch.captured).length, 0);
        assert.equal(JSON.stringify(hidden).includes("unverified"), false);

        const zero = await registerCrawlerVisit(db, owner, visit(brand, { answerCitations: 0 }), clock);
        assert.equal(zero.observation.identity, "unverified");
        assert.equal(zero.observation.citations, 0);
        assert.equal(zero.observation.calledIncluded, false);
        assert.equal(forbiddenCopy.test(JSON.stringify(zero)), false);
        assert.equal(JSON.stringify(zero).includes("userAgent"), false);

        const cited = await registerCrawlerVisit(db, owner, visit(brand, { answerCitations: 9 }), clock);
        assert.equal(cited.observation.identity, "unverified");
        assert.equal(cited.observation.citations, 9);
        assert.equal(cited.observation.calledIncluded, false);

        const verified = await registerCrawlerVisit(db, owner, visit(brand, { identityVerified: true, answerCitations: 4 }), clock);
        assert.equal(verified.observation.identity, "verified");
        assert.equal(verified.observation.citations, 4);
        assert.equal(verified.observation.calledIncluded, false);
        assert.equal(forbiddenCopy.test(JSON.stringify(verified)), false);

        const stored = await queryWithParameters(
          db,
          `SELECT identity, citations, called_included AS "calledIncluded" FROM crawler_observation WHERE id = ?`,
          [zero.observation.id],
        );
        assert.equal(stored[0].identity, "unverified");
        assert.equal(Number(stored[0].citations), 0);
        assert.equal(Number(stored[0].calledIncluded), 0);

        const hiddenRead = await readCrawlerVisit(db, outsider, zero.observation.id);
        assert.deepEqual(hiddenRead, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hiddenRead).includes(zero.observation.id), false);
        const hiddenList = await listCrawlerVisits(db, outsider);
        assert.equal(hiddenList.observations.some((row) => row.id === zero.observation.id), false);
        const visible = await readCrawlerVisit(db, owner, zero.observation.id);
        assert.equal(visible.observation.identity, "unverified");
        assert.equal(visible.observation.calledIncluded, false);

        const listWatch = watch(db);
        const listed = await listCrawlerVisits(listWatch.connection, owner);
        const observationSelects = listWatch.captured.filter((item) => isSelect(item.sql, "crawler_observation"));
        assert.equal(observationSelects.length, 1);
        assert.equal(listed.observations.filter((row) => row.identity === "unverified").length, 2);
        assert.equal(listed.observations.some((row) => row.identity === "verified"), true);

        const rolled = randomUUID();
        await assert.rejects(
          () => db.transaction(async (tx) => {
            await new CrawlerObservationDao(tx).insertObservations([{
              id: rolled,
              brandId: brand,
              ownerId: owner,
              identity: "unverified",
              citations: 1,
              calledIncluded: 0,
              observedAt: time,
            }]);
            throw new Error("rollback-fixture");
          }),
          /rollback-fixture/,
        );
        assert.deepEqual(await readCrawlerVisit(db, owner, rolled), { error: "NOT_FOUND" });

        const extra = Array.from({ length: 3000 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO crawler_observation (
            id, brand_id, owner_id, identity, citations, called_included, observed_at
          ) VALUES ${extra.map(() => "(?, ?, ?, 'unverified', 0, 0, ?)").join(", ")}`,
          extra.flatMap((id) => [id, otherBrand, outsider, time]),
        );
        if (db.kind === "postgresql") await db.query("ANALYZE crawler_observation");
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const ownerQuery = crawlerObservationsForOwnerQuery(owner);
        const ownerPlan = JSON.stringify(await queryWithParameters(db, explain + ownerQuery.sql, ownerQuery.values));
        assert.match(ownerPlan, /crawler_observation_owner_idx/);
        if (db.kind === "postgresql") assert.doesNotMatch(ownerPlan, /Seq Scan on crawler_observation/);

        await assert.rejects(
          () => queryWithParameters(db, `UPDATE crawler_observation SET called_included = 1 WHERE id = ?`, [zero.observation.id]),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(db, `UPDATE crawler_observation SET identity = 'indexed' WHERE id = ?`, [zero.observation.id]),
          /CHECK|check constraint/i,
        );
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
