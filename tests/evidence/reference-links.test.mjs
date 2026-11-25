import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { inspectCitationSource, readCitationSources } from "../../src/features/competitors/commands.ts";
import {
  appendReferenceLink,
  completeManualEvidence,
  readObservation,
  submitManualEvidence,
} from "../../src/features/evidence/commands.ts";
import { EvidenceDao, citationOwnershipQuery } from "../../src/features/evidence/dao.ts";
import { ownedPageJudgement } from "../../src/features/evidence/metrics.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-26T02:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌",
  description: "Synthetic brand for reference links",
  website: "https://yi.example.com",
  aliases: ["乙"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

function manual(brandId, overrides = {}) {
  return {
    action: "submit-manual",
    brandId,
    operationId: randomUUID(),
    questionText: "核对链接是否被算进原生引用",
    answerText: "正文包含 https://body.example/only-in-text ，但没有加入链接表。",
    region: "CN",
    language: "zh-CN",
    requestedNetworkMode: "unknown",
    targetRegion: "CN",
    observedRegion: "unknown",
    newSession: "unknown",
    productMode: "unknown",
    entityVersion: 1,
    citationSetState: "complete",
    citations: [],
    locatorRef: "fixture://reference/locator",
    collectorId: "collector-1",
    contested: false,
    brandName: "乙品牌",
    aliases: ["乙"],
    officialWebsite: "https://yi.example.com",
    ...overrides,
  };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Reference owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: reference links stay out of native citations and third-party support`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const owner = await account(db);
    const outsider = await account(db);
    const brand = randomUUID();
    await new BrandDao(db).insertBrand(owner, brand, time);
    await new BrandDao(db).insertVersion(brand, 1, fields, time);

    const before = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM answer_citation WHERE brand_id = ?", [brand]);
    const saved = await submitManualEvidence(db, owner, manual(brand), clock);
    assert.equal(saved.error, undefined, saved.error);
    assert.equal(saved.observation.citationSetState, "complete");
    assert.equal(saved.citationPool.cited, false);
    assert.equal(saved.latestAnalysis.officialSiteCited, "false");
    assert.equal(saved.citations.length, 0);
    const afterSave = await queryWithParameters(db, "SELECT COUNT(*) AS count FROM answer_citation WHERE brand_id = ?", [brand]);
    assert.equal(Number(afterSave[0].count), Number(before[0].count));

    const nativeUrl = "https://third.example/a?utm_source=native";
    const withNative = await submitManualEvidence(db, owner, manual(brand, {
      questionText: "同一地址的原生引用和搜索候选",
      answerText: "原生引用只应计一次。正文另有 https://ignored.example/text 。",
      citations: [{ rawUrl: nativeUrl, citationOrigin: "consumer_visible", ownership: "third_party", pageStatus: "reachable" }],
    }), clock);
    assert.equal(withNative.citations.length, 1);
    assert.equal(withNative.citations[0].normalizedUrl, "https://third.example/a");

    const operationId = randomUUID();
    const appended = await appendReferenceLink(db, owner, {
      action: "append-reference",
      brandId: brand,
      observationId: withNative.observation.id,
      operationId,
      rawUrl: "https://third.example/a?fbclid=search",
      citationOrigin: "search_candidate",
    }, clock);
    assert.equal(appended.error, undefined, appended.error);
    assert.equal(appended.deduped, false);
    assert.equal(appended.observation.answerText, withNative.observation.answerText);
    assert.equal(appended.observation.fingerprint, withNative.observation.fingerprint);
    assert.equal(appended.observation.citationSetState, "complete");
    assert.equal(appended.latestAnalysis.officialSiteCited, withNative.latestAnalysis.officialSiteCited);
    assert.equal(appended.citations.filter((item) => item.citationOrigin === "consumer_visible").length, 1);
    assert.equal(appended.citations.filter((item) => item.citationOrigin === "search_candidate").length, 1);
    assert.equal(appended.citations.some((item) => item.rawUrl.includes("ignored.example")), false);

    const replay = await appendReferenceLink(db, owner, {
      action: "append-reference",
      brandId: brand,
      observationId: withNative.observation.id,
      operationId,
      rawUrl: "https://third.example/a?fbclid=search",
      citationOrigin: "search_candidate",
    }, clock);
    assert.equal(replay.replayed, true);
    const again = await appendReferenceLink(db, owner, {
      action: "append-reference",
      brandId: brand,
      observationId: withNative.observation.id,
      operationId: randomUUID(),
      rawUrl: "https://third.example/a?gclid=again",
      citationOrigin: "search_candidate",
    }, clock);
    assert.equal(again.deduped, true);
    assert.equal(again.citations.filter((item) => item.citationOrigin === "search_candidate").length, 1);

    const outsiderAppend = await appendReferenceLink(db, outsider, {
      action: "append-reference",
      brandId: brand,
      observationId: withNative.observation.id,
      operationId: randomUUID(),
      rawUrl: "https://outsider.example/nope",
      citationOrigin: "analyst_found",
    }, clock);
    assert.equal(outsiderAppend.error, "NOT_FOUND");
    assert.equal(await readObservation(db, outsider, withNative.observation.id), null);

    const native = appended.citations.find((item) => item.citationOrigin === "consumer_visible");
    const candidate = appended.citations.find((item) => item.citationOrigin === "search_candidate");
    for (const citationId of [native.id, candidate.id]) {
      const inspected = await inspectCitationSource(db, owner, {
        brandId: brand,
        citationId,
        pageLive: true,
        readable: true,
        authorKnown: true,
        supportsBrand: true,
        supportedClaim: "不应让搜索候选进入分子",
      }, clock);
      assert.equal(inspected.error, undefined, inspected.error);
    }
    const sources = await readCitationSources(db, owner, brand);
    assert.equal(sources.error, undefined);
    const listed = sources.citations.filter((item) => item.observationId === withNative.observation.id);
    assert.equal(listed.length, 2);
    assert.deepEqual(listed.map((item) => item.citationOrigin).sort(), ["consumer_visible", "search_candidate"]);
    assert.equal(sources.supportSummary.supportsCount, 1);
    assert.equal(sources.supportSummary.judgableCount, 1);

    const ownedOnly = await submitManualEvidence(db, owner, manual(brand, {
      questionText: "搜索候选不能抬高自有页引用",
      answerText: "只有搜索候选指向官网 https://yi.example.com/about 。",
      citations: [],
    }), clock);
    await queryWithParameters(
      db,
      `INSERT INTO answer_citation (
        id, observation_id, brand_id, raw_url, normalized_url, citation_origin, position_label, ownership, page_status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'search_candidate', NULL, 'owned_domain', 'unknown', ?)`,
      [randomUUID(), ownedOnly.observation.id, brand, "https://yi.example.com/about", "https://yi.example.com/about", time],
    );
    const ownership = await new EvidenceDao(db).citationOwnership(brand, [ownedOnly.observation.id]);
    assert.deepEqual(ownership.get(ownedOnly.observation.id) ?? [], []);
    assert.equal(ownedPageJudgement("complete", ownership.get(ownedOnly.observation.id) ?? []), "false");

    const draft = await submitManualEvidence(db, owner, manual(brand, {
      citationSetState: "missing",
      locatorRef: null,
      answerText: "草稿正文 https://draft.example/text",
    }), clock);
    const draftLink = await appendReferenceLink(db, owner, {
      action: "append-reference",
      brandId: brand,
      observationId: draft.observation.id,
      operationId: randomUUID(),
      rawUrl: "https://draft.example/found",
      citationOrigin: "analyst_found",
    }, clock);
    assert.equal(draftLink.observation.evidenceState, "draft_evidence");
    assert.equal(draftLink.observation.citationSetState, "missing");
    assert.equal(draftLink.citations.length, 1);
    const completed = await completeManualEvidence(db, owner, {
      ...manual(brand, {
        action: "complete-manual",
        observationId: draft.observation.id,
        answerText: "补全后正文仍有 https://draft.example/text",
        citations: [],
      }),
    }, clock);
    assert.equal(completed.error, undefined, completed.error);
    assert.equal(completed.observation.evidenceState, "complete");
    assert.equal(completed.citations.length, 1);
    assert.equal(completed.citations[0].citationOrigin, "analyst_found");
    assert.equal(completed.latestAnalysis.officialSiteCited, "false");

    const built = citationOwnershipQuery(brand, [ownedOnly.observation.id]);
    const explainPrefix = kind === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN (COSTS OFF) ";
    const plan = await queryWithParameters(db, `${explainPrefix}${built.sql}`, built.values);
    console.log(`${kind} reference-link ownership plan ${JSON.stringify(plan)}`);
    assert.match(JSON.stringify(plan), /answer_citation/);
  });
}
