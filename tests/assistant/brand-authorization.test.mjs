import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  confirmPlanItems,
  draftWeeklyPlan,
  executeConfirmedPlan,
  listAssistantPlans,
  readAssistantPlan,
  readAssistantPlanReview,
  readAssistantWorkspace,
  saveAssistantPlanReview,
} from "../../src/features/assistant/commands.ts";
import {
  draftStrategyTemplate,
  listStrategyTemplates,
  readStrategyTemplate,
  readStrategyWorkspace,
  saveStrategyTemplate,
} from "../../src/features/assistant/strategy-commands.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { grantBrandMember, revokeBrandGrant } from "../../src/features/team-access/commands.ts";
import { ensurePersonalGroup } from "../../src/features/team-access/platform-role.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const stamp = "2026-11-26T08:00:00.000Z";
const env = {
  OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  OPENAI_API_KEY: "sk-test-loopback",
  OPENAI_MODEL: "loopback-model",
};

async function createUser(db, label) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, label, `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function grantPlatformAdmin(db, userId) {
  await queryWithParameters(
    db,
    `INSERT INTO platform_account_role (user_id, role, updated_at) VALUES (?, 'admin', ?)`,
    [userId, stamp],
  );
}

async function seedFact(db, brandId, ownerId, title) {
  const id = randomUUID();
  const content = JSON.stringify({ ...emptyFields, title, validity: "longTerm" });
  await queryWithParameters(
    db,
    `INSERT INTO brand_fact_version
      (brand_id, id, fact_id, version, entity_version, paste_id, revision, state, content, created_at, confirmed_by, confirmed_at, revoked_at)
     VALUES (?, ?, ?, 1, 1, NULL, 1, 'approved', ?, ?, ?, ?, NULL)`,
    [brandId, id, id, content, stamp, ownerId, stamp],
  );
  return id;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: assistant plans and strategy templates enforce brand grants, read_only 403, admin read, and outsider 404`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const db = fixture.connection;
      const [owner, member, readOnly, outsider, admin] = await Promise.all([
        createUser(db, "Brand Owner"),
        createUser(db, "Brand Member"),
        createUser(db, "Brand ReadOnly"),
        createUser(db, "Brand Outsider"),
        createUser(db, "Platform Admin"),
      ]);
      await grantPlatformAdmin(db, admin);

      const groupId = await ensurePersonalGroup(db, owner, "Owner Group", stamp);
      const memberGroupId = await ensurePersonalGroup(db, member, "Member Group", stamp);

      const brands = new BrandDao(db);
      const brandA = randomUUID();
      await brands.insertBrand(owner, brandA, stamp, groupId);
      await brands.insertVersion(brandA, 1, {
        ...initialBrandFields,
        name: "协同品牌 A",
        description: "用于验证组内授权的助理品牌",
      }, stamp);

      const brandB = randomUUID();
      await brands.insertBrand(member, brandB, stamp, memberGroupId);
      await brands.insertVersion(brandB, 1, {
        ...initialBrandFields,
        name: "成员自有品牌 B",
        description: "用于验证默认品牌与显式 brandId 上下文切换",
      }, stamp);

      const memberGrant = await grantBrandMember(db, owner, { brandId: brandA, userId: member, role: "member" }, stamp);
      assert.equal(memberGrant.grant.role, "member");
      const memberGrantId = memberGrant.grant.id;
      const readOnlyGrant = await grantBrandMember(db, owner, { brandId: brandA, userId: readOnly, role: "read_only" }, stamp);
      assert.equal(readOnlyGrant.grant.role, "read_only");

      const factA = await seedFact(db, brandA, owner, "品牌 A 已批准事实");
      const factB = await seedFact(db, brandB, member, "品牌 B 已批准事实");

      let aiCalls = 0;
      const fetchImpl = async (_url, init) => {
        aiCalls += 1;
        const payload = JSON.parse(String(init.body));
        const text = payload.input.includes("materials")
          ? JSON.stringify({ explanation: "按观察记录保存模板说明。" })
          : JSON.stringify({ items: [], changeBudget: false, publish: false });
        return new Response(JSON.stringify({
          id: "resp_auth_loopback",
          status: "completed",
          model: "loopback-model",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      };
      const options = { clock: () => "2026-11-26T09:00:00.000Z", env, fetchImpl };

      // Default workspace vs explicit brandId context for member
      const defaultMemberWs = await readAssistantWorkspace(db, member);
      assert.equal(defaultMemberWs.kind, "ready");
      assert.equal(defaultMemberWs.brandId, brandB);
      assert.equal(defaultMemberWs.canWrite, true);
      assert.deepEqual(defaultMemberWs.factOptions.map((f) => f.id), [factB]);

      const brandAMemberWs = await readAssistantWorkspace(db, member, brandA);
      assert.equal(brandAMemberWs.kind, "ready");
      assert.equal(brandAMemberWs.brandId, brandA);
      assert.equal(brandAMemberWs.canWrite, true);
      assert.deepEqual(brandAMemberWs.factOptions.map((f) => f.id), [factA]);

      // Read-only and admin denied before AI call
      const roDraftDenied = await draftWeeklyPlan(db, readOnly, {
        brandId: brandA,
        material: "只读尝试生成草案",
        budgetMinor: 1000,
        successes: 1,
        items: [{ action: "核对品牌 A 事实", factVersionId: factA }],
      }, options);
      assert.deepEqual(roDraftDenied, { error: "FORBIDDEN" });

      const adminDraftDenied = await draftWeeklyPlan(db, admin, {
        brandId: brandA,
        material: "管理员尝试生成草案",
        budgetMinor: 1000,
        successes: 1,
        items: [{ action: "核对品牌 A 事实", factVersionId: factA }],
      }, options);
      assert.deepEqual(adminDraftDenied, { error: "FORBIDDEN" });

      const outsiderDraftDenied = await draftWeeklyPlan(db, outsider, {
        brandId: brandA,
        material: "外部人尝试生成草案",
        budgetMinor: 1000,
        successes: 1,
        items: [{ action: "核对品牌 A 事实", factVersionId: factA }],
      }, options);
      assert.deepEqual(outsiderDraftDenied, { error: "NOT_FOUND" });
      assert.equal(aiCalls, 0);

      // Member drafts, confirms, executes, and reviews plan on brandA
      const drafted = await draftWeeklyPlan(db, member, {
        brandId: brandA,
        material: "本周按已批准事实准备草案",
        budgetMinor: 2000,
        successes: 1,
        items: [{ action: "核对品牌 A 事实", factVersionId: factA }],
      }, options);
      assert.equal(aiCalls, 1);
      assert.equal(drafted.plan.brandId, brandA);

      assert.deepEqual(await confirmPlanItems(db, readOnly, drafted.plan.id, { itemIds: [drafted.plan.items[0].id] }, options), { error: "FORBIDDEN" });
      assert.deepEqual(await confirmPlanItems(db, outsider, drafted.plan.id, { itemIds: [drafted.plan.items[0].id] }, options), { error: "NOT_FOUND" });

      const confirmed = await confirmPlanItems(db, member, drafted.plan.id, { itemIds: [drafted.plan.items[0].id] }, options);
      assert.equal(confirmed.plan.items[0].status, "confirmed");

      assert.deepEqual(await executeConfirmedPlan(db, readOnly, drafted.plan.id, options), { error: "FORBIDDEN" });
      assert.deepEqual(await executeConfirmedPlan(db, outsider, drafted.plan.id, options), { error: "NOT_FOUND" });

      const settled = await executeConfirmedPlan(db, member, drafted.plan.id, options);
      assert.equal(settled.plan.status, "settled");
      assert.equal(settled.plan.items[0].status, "executed");

      assert.deepEqual(await saveAssistantPlanReview(db, readOnly, drafted.plan.id, { nextStep: "只读尝试保存复盘" }, options), { error: "FORBIDDEN" });
      assert.deepEqual(await saveAssistantPlanReview(db, admin, drafted.plan.id, { nextStep: "管理员尝试保存复盘" }, options), { error: "FORBIDDEN" });
      assert.deepEqual(await saveAssistantPlanReview(db, outsider, drafted.plan.id, { nextStep: "外部尝试保存复盘" }, options), { error: "NOT_FOUND" });

      const reviewed = await saveAssistantPlanReview(db, member, drafted.plan.id, { nextStep: "成员已完成复盘。" }, options);
      assert.equal(reviewed.plan.review?.nextStep, "成员已完成复盘。");

      // Owner, read_only, and admin can read the same plan & review
      for (const reader of [owner, readOnly, admin]) {
        const ws = await readAssistantWorkspace(db, reader, brandA);
        assert.equal(ws.kind, "ready");
        assert.equal(ws.brandId, brandA);
        assert.equal(ws.canWrite, reader === owner);
        assert.equal(ws.plans.length, 1);
        assert.equal(ws.plans[0].review?.nextStep, "成员已完成复盘。");
        const single = await readAssistantPlan(db, reader, drafted.plan.id);
        assert.equal(single.plan.id, drafted.plan.id);
        const rev = await readAssistantPlanReview(db, reader, drafted.plan.id);
        assert.equal(rev.review.nextStep, "成员已完成复盘。");
      }

      // Outsider gets not-found on workspace with brandId, no-brand without brandId, and NOT_FOUND on APIs
      assert.deepEqual(await readAssistantWorkspace(db, outsider, brandA), { kind: "not-found" });
      assert.deepEqual(await readAssistantWorkspace(db, outsider), { kind: "no-brand" });
      assert.deepEqual(await listAssistantPlans(db, outsider, brandA), { error: "NOT_FOUND" });
      assert.deepEqual(await readAssistantPlan(db, outsider, drafted.plan.id), { error: "NOT_FOUND" });
      assert.deepEqual(await readAssistantPlanReview(db, outsider, drafted.plan.id), { error: "NOT_FOUND" });

      // Strategy templates: member saves & drafts; read_only & admin can read, cannot write; outsider 404
      assert.deepEqual(await saveStrategyTemplate(db, readOnly, {
        brandId: brandA,
        industry: "只读测试行业",
        samplingCondition: "采样条件",
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: "失败案例",
        explanation: "说明",
      }, options), { error: "FORBIDDEN" });
      assert.deepEqual(await draftStrategyTemplate(db, readOnly, {
        brandId: brandA,
        industry: "只读测试行业",
        samplingCondition: "采样条件",
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: "失败案例",
        materials: "材料",
      }, options), { error: "FORBIDDEN" });
      assert.deepEqual(await saveStrategyTemplate(db, admin, {
        brandId: brandA,
        industry: "管理员测试行业",
        samplingCondition: "采样条件",
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: "失败案例",
        explanation: "说明",
      }, options), { error: "FORBIDDEN" });
      assert.deepEqual(await saveStrategyTemplate(db, outsider, {
        brandId: brandA,
        industry: "外部测试行业",
        samplingCondition: "采样条件",
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: "失败案例",
        explanation: "说明",
      }, options), { error: "NOT_FOUND" });
      assert.equal(aiCalls, 1);

      const savedStrategy = await saveStrategyTemplate(db, member, {
        brandId: brandA,
        industry: "组内协作行业",
        samplingCondition: "目标城市北京，实际采样未声明定位",
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: "上次样本仅 1 次。",
        explanation: "按观察记录保存。高胜率必有效。",
      }, options);
      assert.equal(savedStrategy.template.brandId, brandA);
      assert.equal(savedStrategy.template.explanation, "按观察记录保存。");

      const draftedStrategy = await draftStrategyTemplate(db, member, {
        brandId: brandA,
        industry: "组内起草行业",
        samplingCondition: "目标城市上海，实际采样未声明定位",
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: "缺少对照样本。",
        materials: "materials",
      }, options);
      assert.equal(aiCalls, 2);
      assert.equal(draftedStrategy.template.brandId, brandA);

      for (const reader of [owner, member, readOnly, admin]) {
        const ws = await readStrategyWorkspace(db, reader, brandA);
        assert.equal(ws.kind, "ready");
        assert.equal(ws.brandId, brandA);
        assert.equal(ws.canWrite, reader === owner || reader === member);
        assert.equal(ws.templates.length, 2);
        const listed = await listStrategyTemplates(db, reader, brandA);
        assert.equal(listed.templates.length, 2);
        const single = await readStrategyTemplate(db, reader, savedStrategy.template.id);
        assert.equal(single.template.id, savedStrategy.template.id);
      }

      assert.deepEqual(await readStrategyWorkspace(db, outsider, brandA), { kind: "not-found" });
      assert.deepEqual(await readStrategyWorkspace(db, outsider), { kind: "no-brand" });
      assert.deepEqual(await listStrategyTemplates(db, outsider, brandA), { error: "NOT_FOUND" });
      assert.deepEqual(await readStrategyTemplate(db, outsider, savedStrategy.template.id), { error: "NOT_FOUND" });

      // Revoking member grant immediately blocks read & write on brandA
      assert.equal((await revokeBrandGrant(db, owner, memberGrantId, "2026-11-26T10:00:00.000Z")).error, undefined);
      assert.deepEqual(await readAssistantWorkspace(db, member, brandA), { kind: "not-found" });
      assert.deepEqual(await readStrategyWorkspace(db, member, brandA), { kind: "not-found" });
      assert.deepEqual(await listAssistantPlans(db, member, brandA), { error: "NOT_FOUND" });
      assert.deepEqual(await readAssistantPlan(db, member, drafted.plan.id), { error: "NOT_FOUND" });
      assert.deepEqual(await saveAssistantPlanReview(db, member, drafted.plan.id, { nextStep: "已撤权" }, options), { error: "NOT_FOUND" });
      assert.deepEqual(await listStrategyTemplates(db, member, brandA), { error: "NOT_FOUND" });
      assert.deepEqual(await readStrategyTemplate(db, member, savedStrategy.template.id), { error: "NOT_FOUND" });
      assert.deepEqual(await saveStrategyTemplate(db, member, {
        brandId: brandA,
        industry: "撤权后行业",
        samplingCondition: "采样条件",
        successes: 1,
        evidenceStrength: "single_observation",
        failureCase: "失败案例",
        explanation: "说明",
      }, options), { error: "NOT_FOUND" });
    } finally {
      await fixture.cleanup();
    }
  });
}
