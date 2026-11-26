import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  appendReferenceLink,
  readObservation,
  reviseAnalysis,
  submitManualEvidence,
  updateCitationOwnership,
} from "../../src/features/evidence/commands.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import { grantBrandMember } from "../../src/features/team-access/commands.ts";
import { memoryCache, openCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-26T08:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌",
  description: "Synthetic brand for citation ownership",
  website: "https://yi.example.com",
  aliases: ["乙"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

async function account(db, label = "Owner") {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, label, `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function manualObservation(brandId, overrides = {}) {
  return {
    action: "submit-manual",
    brandId,
    operationId: randomUUID(),
    questionText: "哪家工业设备值得优先了解？",
    answerText: "可查看乙品牌在行业平台上的说明页。",
    region: "CN",
    language: "zh-CN",
    requestedNetworkMode: "off",
    targetRegion: "CN",
    observedRegion: "unknown",
    newSession: "unknown",
    productMode: "unknown",
    entityVersion: 1,
    citationSetState: "complete",
    citations: [
      {
        rawUrl: "https://share.example.com/brand-yi?utm_source=test",
        citationOrigin: "consumer_visible",
        ownership: "unknown",
        pageStatus: "unknown",
      },
      {
        rawUrl: "https://media.example.org/review-yi",
        citationOrigin: "provider_native",
        ownership: "unknown",
        pageStatus: "unknown",
      },
    ],
    locatorRef: "fixture://citation-ownership/1",
    collectorId: "collector-1",
    contested: false,
    brandName: "乙品牌",
    aliases: ["乙"],
    officialWebsite: "https://yi.example.com",
    ...overrides,
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: confirm native citation ownership drives Jo, invalidates cache, enforces auth and idempotency`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const [owner, member, readOnly, outsider] = await Promise.all([
      account(db, "Owner"),
      account(db, "Member"),
      account(db, "ReadOnly"),
      account(db, "Outsider"),
    ]);

    const brand = randomUUID();
    await new BrandDao(db).insertBrand(owner, brand, time);
    await new BrandDao(db).insertVersion(brand, 1, fields, time);
    await grantBrandMember(db, owner, { userId: member, brandId: brand, role: "member", expiresAt: null }, time);
    await grantBrandMember(db, owner, { userId: readOnly, brandId: brand, role: "read_only", expiresAt: null }, time);

    const saved = await submitManualEvidence(db, owner, manualObservation(brand), clock);
    assert.equal(saved.error, undefined, saved.error);
    assert.equal(saved.observation.citationSetState, "complete");
    assert.equal(saved.citations.length, 2);
    assert.ok(saved.citations.every((item) => item.ownership === "unknown" && item.pageStatus === "unknown"));

    // Also attach a search_candidate and analyst_found link that must never be editable or enter Jo/Jc
    const searchAdded = await appendReferenceLink(db, owner, {
      action: "append-reference",
      brandId: brand,
      observationId: saved.observation.id,
      operationId: randomUUID(),
      rawUrl: "https://yi.example.com/search-candidate",
      citationOrigin: "search_candidate",
    }, clock);
    assert.equal(searchAdded.error, undefined, searchAdded.error);
    const analystAdded = await appendReferenceLink(db, owner, {
      action: "append-reference",
      brandId: brand,
      observationId: saved.observation.id,
      operationId: randomUUID(),
      rawUrl: "https://yi.example.com/analyst-found",
      citationOrigin: "analyst_found",
    }, clock);
    assert.equal(analystAdded.error, undefined, analystAdded.error);

    const searchCitation = analystAdded.citations.find((item) => item.citationOrigin === "search_candidate");
    const analystCitation = analystAdded.citations.find((item) => item.citationOrigin === "analyst_found");
    const shareCitation = analystAdded.citations.find((item) => item.normalizedUrl === "https://share.example.com/brand-yi");
    const mediaCitation = analystAdded.citations.find((item) => item.normalizedUrl === "https://media.example.org/review-yi");
    assert.ok(searchCitation && analystCitation && shareCitation && mediaCitation);

    // Search/analyst reference links cannot be edited via updateCitationOwnership
    for (const refCitation of [searchCitation, analystCitation]) {
      const refAttempt = await updateCitationOwnership(db, owner, {
        action: "update-citation",
        brandId: brand,
        observationId: saved.observation.id,
        citationId: refCitation.id,
        operationId: randomUUID(),
        ownership: "owned_domain",
        pageStatus: "reachable",
      }, clock);
      assert.equal(refAttempt.error, "INVALID_INPUT");
    }

    const sharedCache = memoryCache();
    const otherCache = memoryCache();
    const overviewScope = { brandId: brand, sourceMode: "consumer_ui" };
    const beforeOverview = await readEvidenceOverview(db, owner, overviewScope, sharedCache, clock);
    assert.equal(beforeOverview.metrics.ownedPageCited.status, "na");
    assert.equal(beforeOverview.metrics.ownedPageCited.reason, "no-judgable-owned-citations");
    await readEvidenceOverview(db, owner, overviewScope, otherCache, clock);

    const probeUrl = process.env.REDIS_URL;
    const redisA = probeUrl ? openCache({ GEO_CACHE_DRIVER: "redis", REDIS_URL: probeUrl }) : null;
    const redisB = probeUrl ? openCache({ GEO_CACHE_DRIVER: "redis", REDIS_URL: probeUrl }) : null;

    const opId = randomUUID();
    const confirmation = {
      action: "update-citation",
      brandId: brand,
      observationId: saved.observation.id,
      citationId: shareCitation.id,
      operationId: opId,
      ownership: "owned_account",
      pageStatus: "reachable",
    };
    let statements = 0;
    const watched = {
      ...db,
      transaction: (work) => db.transaction((tx) => work({
        ...tx,
        query(sql, values) {
          statements += 1;
          return tx.query(sql, values);
        },
      })),
    };
    const start = performance.now();
    const confirmed = await updateCitationOwnership(watched, owner, confirmation, clock, sharedCache);
    const elapsed = performance.now() - start;
    assert.deepEqual(confirmed, {
      citation: { id: shareCitation.id, ownership: "owned_account", pageStatus: "reachable" },
      replayed: false,
    });
    assert.equal(statements, 6);
    console.log(`${kind} citation update: ${statements} SQL statements in ${elapsed.toFixed(1)} ms`);
    const afterDetail = await readObservation(db, owner, saved.observation.id);
    assert.deepEqual(afterDetail.observation, saved.observation);
    assert.deepEqual(afterDetail.analyses, saved.analyses);
    assert.equal(afterDetail.citations.find((item) => item.id === shareCitation.id).rawUrl, shareCitation.rawUrl);

    const afterShared = await readEvidenceOverview(db, owner, overviewScope, sharedCache, clock);
    assert.equal(afterShared.metrics.ownedPageCited.status, "ready");
    assert.equal(afterShared.metrics.ownedPageCited.equalWeight, 1);
    assert.deepEqual(afterShared.metrics.ownedPageCited.pooled, { numerator: 1, denominator: 1, rate: 1 });
    assert.deepEqual(afterShared.metrics.ownedPageCited.perQuestion[0]?.numerator, 1);
    assert.deepEqual(afterShared.metrics.ownedPageCited.perQuestion[0]?.denominator, 1);

    const afterOther = await readEvidenceOverview(db, owner, overviewScope, otherCache, clock);
    assert.equal(afterOther.metrics.ownedPageCited.equalWeight, 1);

    if (redisA && redisB && (await redisA.get(`evidence-overview:probe:${randomUUID()}`)).state !== "blocked") {
      const redisBefore = await readEvidenceOverview(db, owner, overviewScope, redisA, clock);
      assert.equal(redisBefore.metrics.ownedPageCited.equalWeight, 1);
      const deleted = [];
      const redisWriter = { ...redisA, async delete(key) {
        deleted.push(key);
        await redisA.delete(key);
      } };
      const rollback = await updateCitationOwnership(db, owner, {
        ...confirmation,
        operationId: randomUUID(),
        ownership: "unknown",
      }, clock, redisWriter);
      assert.equal(rollback.citation.ownership, "unknown");
      assert.ok(deleted.some((key) => key.startsWith("evidence-overview:v1:")));
      const afterRedis = await readEvidenceOverview(db, owner, overviewScope, redisB, clock);
      assert.equal(afterRedis.metrics.ownedPageCited.status, "na");
      console.log(`${kind} Redis: Jo 1/1 → N/A after invalidation, read by a second client`);
    }

    const replayed = await updateCitationOwnership(db, owner, confirmation, clock, sharedCache);
    assert.deepEqual(replayed, { ...confirmed, replayed: true });

    const conflict = await updateCitationOwnership(db, owner, {
      ...confirmation,
      ownership: "third_party",
    }, clock, sharedCache);
    assert.deepEqual(conflict, { error: "OPERATION_CONFLICT", next: null });

    for (const deniedActor of [outsider, readOnly]) {
      const rejected = await updateCitationOwnership(db, deniedActor, confirmation, clock, sharedCache);
      assert.deepEqual(rejected, { error: "NOT_FOUND", next: null });
      assert.equal(await readObservation(db, deniedActor, saved.observation.id), null);
    }
    const readOnlyOverview = await readEvidenceOverview(db, readOnly, overviewScope, sharedCache, clock);
    assert.equal(readOnlyOverview.scope.brandId, brand);

    const retryInput = { ...confirmation, operationId: randomUUID() };
    const concurrent = await Promise.all([
      updateCitationOwnership(db, owner, retryInput, clock, sharedCache),
      updateCitationOwnership(db, owner, retryInput, clock, sharedCache),
    ]);
    assert.deepEqual(concurrent.map((result) => result.replayed).sort(), [false, true]);
    for (const result of concurrent) assert.deepEqual(result.citation, confirmed.citation);

    // Insert a historical ReportSnapshot and confirm updating a native citation to owned_domain
    // leaves ReportSnapshot bytes untouched and leaves officialSiteCited unchanged until AnalysisVersion revision
    const retestId = randomUUID();
    const snapshotId = randomUUID();
    const snapshotJson = JSON.stringify({ officialSiteCited: "unknown", observationId: saved.observation.id });
    const snapshotHtml = "<html><body>historical-snapshot-fixture</body></html>";
    const snapshotJsonSha = createHash("sha256").update(snapshotJson, "utf8").digest("hex");
    const snapshotHtmlSha = createHash("sha256").update(snapshotHtml, "utf8").digest("hex");
    await queryWithParameters(
      db,
      `INSERT INTO report_retest (
        id, brand_id, owner_id, kind, status, intent, track, timezone, entity_version,
        operation_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'exploratory', 'completed', 'diagnostic', 'consumer_ui', 'Asia/Shanghai', 1, ?, ?, ?)`,
      [retestId, brand, owner, randomUUID(), time, time],
    );
    await queryWithParameters(
      db,
      `INSERT INTO report_snapshot (
        id, brand_id, owner_id, retest_id, status, grade, intent, loop_completed,
        entity_version, timezone, locale, source_missing,
        json_bytes, html_bytes, json_sha256, html_sha256, operation_id, created_at
      ) VALUES (?, ?, ?, ?, 'created', 'exploratory', 'diagnostic', 0, 1, 'Asia/Shanghai', 'zh-CN', 0, ?, ?, ?, ?, ?, ?)`,
      [snapshotId, brand, owner, retestId, snapshotJson, snapshotHtml, snapshotJsonSha, snapshotHtmlSha, randomUUID(), time],
    );

    // Granted member CAN update the second native citation to owned_domain
    // Confirming owned_domain does NOT auto-rewrite officialSiteCited or ReportSnapshot bytes
    const memberUpdated = await updateCitationOwnership(db, member, {
      action: "update-citation",
      brandId: brand,
      observationId: saved.observation.id,
      citationId: mediaCitation.id,
      operationId: randomUUID(),
      ownership: "owned_domain",
      pageStatus: "reachable",
    }, clock, sharedCache);
    assert.equal(memberUpdated.citation.ownership, "owned_domain");
    const memberDetail = await readObservation(db, member, saved.observation.id);
    assert.equal(memberDetail.latestAnalysis.id, saved.latestAnalysis.id);
    assert.equal(memberDetail.latestAnalysis.officialSiteCited, "unknown");
    const [snapshotRow] = await queryWithParameters(
      db,
      `SELECT json_bytes AS "jsonBytes", html_bytes AS "htmlBytes", json_sha256 AS "jsonSha256", html_sha256 AS "htmlSha256"
       FROM report_snapshot WHERE id = ?`,
      [snapshotId],
    );
    assert.equal(snapshotRow.jsonBytes, snapshotJson);
    assert.equal(snapshotRow.htmlBytes, snapshotHtml);
    assert.equal(snapshotRow.jsonSha256, snapshotJsonSha);
    assert.equal(snapshotRow.htmlSha256, snapshotHtmlSha);

    // Check explicit analysis revision path still works independently
    const revised = await reviseAnalysis(db, owner, {
      action: "revise-analysis",
      brandId: brand,
      observationId: saved.observation.id,
      expectedVersion: 1,
      operationId: randomUUID(),
      mentioned: "true",
      recommended: "unknown",
      officialSiteCited: "true",
      reason: "确认官网域名归属后独立修订官方引用判定",
    }, clock, sharedCache);
    assert.equal("error" in revised, false);
    if ("error" in revised) return;
    assert.equal(revised.latestAnalysis.version, 2);
    assert.equal(revised.latestAnalysis.officialSiteCited, "true");

    // Verify query plan uses PK/index on answer_citation
    const explainPrefix = kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
    const updatePlan = JSON.stringify(await queryWithParameters(
      db,
      `${explainPrefix}UPDATE answer_citation SET ownership = ?, page_status = ? WHERE id = ? AND observation_id = ? AND brand_id = ? AND citation_origin IN ('provider_native', 'consumer_visible')`,
      ["owned_account", "reachable", shareCitation.id, saved.observation.id, brand],
    ));
    console.log(`${kind} citation ownership update plan ${updatePlan}`);
    assert.match(updatePlan, /answer_citation/);
  });
}
