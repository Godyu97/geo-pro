import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  createContentBriefFromResearch,
  createOptimizationTaskFromResearch,
  inspectCitationSource,
  proposeResearchBrief,
  readCitationSources,
  readCompetitorShare,
  readCompetitorWorkspace,
  readResearchBriefs,
  recordCompetitorMentions,
  saveCompetitorSet,
  setResearchBriefStatus,
} from "../../src/features/competitors/commands.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import { grantBrandMember, revokeBrandGrant } from "../../src/features/team-access/commands.ts";
import { ensurePersonalGroup } from "../../src/features/team-access/platform-role.ts";
import { memoryCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-27T08:00:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);

const brandFields = {
  name: "竞品协作品牌",
  description: "Synthetic brand for competitors brand authorization",
  website: "https://comp-collab.example.com",
  aliases: ["竞品协作"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

async function createUser(db, label) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, label, `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  const groupId = await ensurePersonalGroup(db, id, time);
  return { id, groupId };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: group member, read_only, outsider, and revoked competitor & source authorization`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const cache = memoryCache();

    const [owner, member, readOnly, outsider] = await Promise.all([
      createUser(db, "Owner"),
      createUser(db, "Member"),
      createUser(db, "ReadOnly"),
      createUser(db, "Outsider"),
    ]);

    const brandId = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner.id, brandId, time, owner.groupId);
    await brands.insertVersion(brandId, 1, brandFields, time);

    const memberGrant = await grantBrandMember(db, owner.id, {
      userId: member.id,
      brandId,
      role: "member",
      expiresAt: null,
    }, time);
    assert.equal(memberGrant.error, undefined);

    const readOnlyGrant = await grantBrandMember(db, owner.id, {
      userId: readOnly.id,
      brandId,
      role: "read_only",
      expiresAt: null,
    }, time);
    assert.equal(readOnlyGrant.error, undefined);

    // Seed an approved fact version owned by owner.id
    const factId = randomUUID();
    const scope = { ownerId: owner.id, brandId };
    const runFact = (command) => executeFactCommand(db, scope, command, factClock);
    const fact = {
      ...emptyFields,
      category: "specification",
      title: "交付说明",
      claim: "标准交付周期写入正式合同",
      sourceType: "internal",
      sourceReference: "INTERNAL-DOC-REF",
      sourceLocator: "第 3 条",
      sourceExcerpt: "公开摘录。",
      sourceDate: "2026-11-20",
      permission: "public",
      validity: "dated",
      validThrough: "2026-12-31",
    };
    assert.deepEqual(await runFact({ action: "create", id: factId, previousId: null, fields: fact }), { id: factId });
    assert.deepEqual(await runFact({ action: "submit", id: factId, revision: 1 }), { id: factId });
    assert.deepEqual(await runFact({
      action: "approve", id: factId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
    }), { id: factId });

    // Seed an answer observation with native citations
    const posUrl = "https://third-positive.example.com/review-1";
    const negUrl = "https://third-negative.example.com/review-2";
    const limUrl = "https://third-limited.example.com/review-3";
    const saved = await submitManualEvidence(db, owner.id, {
      action: "submit-manual",
      brandId,
      operationId: randomUUID(),
      questionText: "哪家方案提供私有部署？",
      answerText: "回答提到竞品甲并引用了三家第三方评测页面。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [
        { rawUrl: posUrl, citationOrigin: "consumer_visible", ownership: "third_party", pageStatus: "reachable" },
        { rawUrl: negUrl, citationOrigin: "consumer_visible", ownership: "third_party", pageStatus: "reachable" },
        { rawUrl: limUrl, citationOrigin: "consumer_visible", ownership: "third_party", pageStatus: "restricted" },
      ],
      locatorRef: "fixture://comp-auth/1",
      collectorId: owner.id,
      contested: false,
      brandName: brandFields.name,
      aliases: brandFields.aliases,
      officialWebsite: brandFields.website,
      mentioned: "true",
      recommended: "false",
      officialSiteCited: "false",
    }, clock);
    assert.equal(saved.error, undefined);
    const observationId = saved.observation.id;
    const posCitation = saved.citations.find((c) => c.rawUrl === posUrl);
    const negCitation = saved.citations.find((c) => c.rawUrl === negUrl);
    const limCitation = saved.citations.find((c) => c.rawUrl === limUrl);
    assert.ok(posCitation && negCitation && limCitation);

    // 1. Member can save competitor set, record mentions, inspect citations, propose/accept brief, and hand off.
    const setRes = await saveCompetitorSet(db, member.id, {
      brandId,
      labels: ["竞品甲", "竞品乙"],
    }, clock);
    assert.equal(setRes.error, undefined);
    assert.equal(setRes.created, true);
    assert.equal(setRes.set.ownerId, owner.id);
    const setId = setRes.set.id;

    const mentionRes = await recordCompetitorMentions(db, member.id, {
      brandId,
      setId,
      observationId,
      ordered: true,
      mentions: [
        { label: "竞品甲", state: "true", position: 1 },
        { label: "竞品乙", state: "false" },
      ],
    }, clock);
    assert.equal(mentionRes.error, undefined);
    assert.equal(mentionRes.recorded, 2);

    const posInspect = await inspectCitationSource(db, member.id, {
      brandId,
      citationId: posCitation.id,
      pageLive: true,
      readable: true,
      authorKnown: true,
      supportsBrand: true,
      supportedClaim: "",
      factVersionId: factId,
    }, clock);
    assert.equal(posInspect.error, undefined);
    assert.equal(posInspect.support, "supports");
    assert.equal(posInspect.inspection.supportedClaim, "标准交付周期写入正式合同");

    const negInspect = await inspectCitationSource(db, member.id, {
      brandId,
      citationId: negCitation.id,
      pageLive: true,
      readable: true,
      authorKnown: true,
      supportsBrand: false,
    }, clock);
    assert.equal(negInspect.error, undefined);
    assert.equal(negInspect.support, "does_not_support");

    const limInspect = await inspectCitationSource(db, member.id, {
      brandId,
      citationId: limCitation.id,
      pageLive: true,
      readable: false,
      authorKnown: true,
      supportsBrand: true,
    }, clock);
    assert.equal(limInspect.error, undefined);
    assert.equal(limInspect.support, "unknown");
    assert.equal(limInspect.state, "limited");

    const copiedRefused = await proposeResearchBrief(db, member.id, {
      brandId,
      questionCluster: "私有部署比较",
      gap: "只换名字",
      facts: ["标准交付周期写入正式合同"],
      sourceIds: [negCitation.id],
      sourceText: "竞品甲交付快",
      briefText: "竞品协作交付快",
      sourceBrand: "竞品甲",
      ownBrand: "竞品协作",
    }, clock);
    assert.equal(copiedRefused.error, "INVALID_INPUT");
    assert.equal(copiedRefused.reason, "copied_replacement");

    const proposed = await proposeResearchBrief(db, member.id, {
      brandId,
      questionCluster: "私有部署比较",
      gap: "补充私有部署交付边界",
      facts: ["标准交付周期写入正式合同"],
      sourceIds: [negCitation.id],
      sourceText: "竞品甲说明了部署方式",
      briefText: "单独写清本品牌标准交付周期与验收边界。",
      sourceBrand: "竞品甲",
      ownBrand: "竞品协作",
    }, clock);
    assert.equal(proposed.error, undefined);
    const briefId = proposed.brief.id;

    const accepted = await setResearchBriefStatus(db, member.id, {
      brandId,
      briefId,
      status: "accepted",
    }, clock);
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.status, "accepted");

    const contentHandoff = await createContentBriefFromResearch(db, member.id, {
      brandId,
      briefId,
    }, clock);
    assert.equal(contentHandoff.error, undefined);
    assert.equal(contentHandoff.created, true);
    assert.equal(contentHandoff.competitorSource, negUrl);
    assert.deepEqual(contentHandoff.factVersionIds, [factId]);

    const taskHandoff = await createOptimizationTaskFromResearch(db, member.id, {
      brandId,
      briefId,
    }, clock, cache);
    assert.equal(taskHandoff.error, undefined);
    assert.equal(taskHandoff.created, true);

    // Owner and member read the exact same workspace, share, citations, and briefs.
    const [ownerWs, memberWs] = await Promise.all([
      readCompetitorWorkspace(db, owner.id, brandId),
      readCompetitorWorkspace(db, member.id, brandId),
    ]);
    assert.equal("error" in ownerWs, false);
    assert.equal("error" in memberWs, false);
    assert.equal(ownerWs.sets.length, 1);
    assert.equal(memberWs.sets.length, 1);
    assert.equal(ownerWs.citations.length, 3);
    assert.equal(memberWs.citations.length, 3);
    assert.equal(ownerWs.supportSummary.supportRate, 0.5);
    assert.equal(memberWs.supportSummary.supportRate, 0.5);
    assert.equal(ownerWs.briefs.length, 1);
    assert.equal(memberWs.briefs.length, 1);
    assert.equal(memberWs.briefs[0].contentBriefId, contentHandoff.contentBriefId);
    assert.equal(memberWs.briefs[0].optimizationTaskId, taskHandoff.taskId);

    // 2. read_only sees aggregate share & third-party support summary, never unapproved citation URLs,
    // and all write operations return FORBIDDEN.
    const [roWs, roShare, roSources, roBriefs] = await Promise.all([
      readCompetitorWorkspace(db, readOnly.id, brandId),
      readCompetitorShare(db, readOnly.id, brandId),
      readCitationSources(db, readOnly.id, brandId),
      readResearchBriefs(db, readOnly.id, brandId),
    ]);
    assert.equal("error" in roWs, false);
    assert.equal("error" in roShare, false);
    assert.equal("error" in roSources, false);
    assert.equal("error" in roBriefs, false);

    assert.equal(roWs.role, "read_only");
    assert.equal(roWs.sets.length, 1);
    assert.equal(roWs.rows.find((row) => row.brandId === "竞品甲")?.pooledCount, 1);
    assert.equal(roWs.rank.ranked, true);
    assert.equal(roWs.citationCount, 3);
    assert.equal(roWs.supportSummary.supportRate, 0.5);
    assert.equal(roWs.supportSummary.supportsCount, 1);
    assert.equal(roWs.supportSummary.doesNotSupportCount, 1);
    assert.equal(roWs.supportSummary.unknownCount, 1);
    assert.deepEqual(roWs.citations, []);
    assert.deepEqual(roWs.hosts, []);
    assert.deepEqual(roWs.observations, []);
    assert.deepEqual(roWs.usableFacts, []);

    assert.equal(roSources.citationCount, 3);
    assert.equal(roSources.supportSummary.supportRate, 0.5);
    assert.deepEqual(roSources.citations, []);
    assert.deepEqual(roSources.hosts, []);

    const roPayloadText = JSON.stringify({ roWs, roShare, roSources, roBriefs });
    assert.equal(roPayloadText.includes("third-positive.example.com"), false);
    assert.equal(roPayloadText.includes("third-negative.example.com"), false);
    assert.equal(roPayloadText.includes("third-limited.example.com"), false);

    const readOnlyWrites = [
      await saveCompetitorSet(db, readOnly.id, { brandId, labels: ["竞品丙"] }, clock),
      await recordCompetitorMentions(db, readOnly.id, {
        brandId, setId, observationId, ordered: false, mentions: [{ label: "竞品甲", state: "true" }],
      }, clock),
      await inspectCitationSource(db, readOnly.id, {
        brandId, citationId: posCitation.id, pageLive: true, readable: true, authorKnown: true, supportsBrand: false,
      }, clock),
      await proposeResearchBrief(db, readOnly.id, {
        brandId,
        questionCluster: "只读拦截",
        gap: "不应写入",
        facts: [],
        sourceIds: [posCitation.id],
        sourceText: "原文",
        briefText: "原创角度",
        sourceBrand: "竞品甲",
        ownBrand: "竞品协作",
      }, clock),
      await setResearchBriefStatus(db, readOnly.id, { brandId, briefId, status: "dismissed" }, clock),
      await createContentBriefFromResearch(db, readOnly.id, { brandId, briefId }, clock),
      await createOptimizationTaskFromResearch(db, readOnly.id, { brandId, briefId }, clock, cache),
    ];
    for (const denied of readOnlyWrites) {
      assert.equal(denied.error, "FORBIDDEN");
    }

    // 3. outsider receives NOT_FOUND across all read and write commands without leaking data.
    const outsiderChecks = [
      await readCompetitorWorkspace(db, outsider.id, brandId),
      await readCompetitorShare(db, outsider.id, brandId),
      await readCitationSources(db, outsider.id, brandId),
      await readResearchBriefs(db, outsider.id, brandId),
      await saveCompetitorSet(db, outsider.id, { brandId, labels: ["竞品丙"] }, clock),
      await recordCompetitorMentions(db, outsider.id, {
        brandId, setId, observationId, ordered: false, mentions: [{ label: "竞品甲", state: "true" }],
      }, clock),
      await inspectCitationSource(db, outsider.id, {
        brandId, citationId: posCitation.id, pageLive: true, readable: true, authorKnown: true, supportsBrand: true,
      }, clock),
      await proposeResearchBrief(db, outsider.id, {
        brandId,
        questionCluster: "越权",
        gap: "越权缺口",
        facts: [],
        sourceIds: [posCitation.id],
        sourceText: "原文",
        briefText: "原创角度",
        sourceBrand: "竞品甲",
        ownBrand: "竞品协作",
      }, clock),
      await setResearchBriefStatus(db, outsider.id, { brandId, briefId, status: "dismissed" }, clock),
      await createContentBriefFromResearch(db, outsider.id, { brandId, briefId }, clock),
      await createOptimizationTaskFromResearch(db, outsider.id, { brandId, briefId }, clock, cache),
    ];
    for (const check of outsiderChecks) {
      assert.equal(check.error, "NOT_FOUND");
      const text = JSON.stringify(check);
      assert.equal(text.includes(brandFields.name), false);
      assert.equal(text.includes("竞品甲"), false);
      assert.equal(text.includes("third-positive.example.com"), false);
    }

    // 4. Revoking member grant immediately revokes both read and write access.
    const revoked = await revokeBrandGrant(db, owner.id, memberGrant.grant.id, time);
    assert.equal(revoked.error, undefined);
    assert.equal((await readCompetitorWorkspace(db, member.id, brandId)).error, "NOT_FOUND");
    assert.equal((await readCompetitorShare(db, member.id, brandId)).error, "NOT_FOUND");
    assert.equal((await readCitationSources(db, member.id, brandId)).error, "NOT_FOUND");
    assert.equal((await readResearchBriefs(db, member.id, brandId)).error, "NOT_FOUND");
    assert.equal((await saveCompetitorSet(db, member.id, { brandId, labels: ["竞品丙"] }, clock)).error, "NOT_FOUND");
  });
}
