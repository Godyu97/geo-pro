import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { saveBriefDraft } from "../../src/features/content/commands.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import {
  confirmActionDraft,
  dismissActionDraft,
  draftFromEvidence,
  listActionDrafts,
} from "../../src/features/optimization/action-drafts.ts";
import {
  checkPages,
  generateFromEvidence,
  listPrioritizedTasks,
  readTaskDetail,
  updateTask,
} from "../../src/features/optimization/commands.ts";
import { grantBrandMember, revokeBrandGrant } from "../../src/features/team-access/commands.ts";
import { ensurePersonalGroup } from "../../src/features/team-access/platform-role.ts";
import { memoryCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-27T08:00:00.000Z";
const clock = () => time;
const env = {
  OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "loopback-model",
};
const brandFields = {
  name: "协作品牌",
  description: "Synthetic brand for optimization brand authorization",
  website: "https://collab.example.com",
  aliases: ["协作"],
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
  test(`${kind}: group member, read_only, outsider, and revoked optimization authorization`, async (t) => {
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

    const obs1 = await submitManualEvidence(db, owner.id, {
      action: "submit-manual",
      brandId,
      operationId: randomUUID(),
      questionText: "工业设备怎么选型？",
      answerText: "回答未提及协作品牌。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://auth-opt/1",
      collectorId: owner.id,
      contested: false,
      brandName: brandFields.name,
      aliases: brandFields.aliases,
      officialWebsite: brandFields.website,
      mentioned: "false",
      recommended: "false",
      officialSiteCited: "false",
    }, clock);
    assert.equal(obs1.error, undefined);

    const obs2 = await submitManualEvidence(db, owner.id, {
      action: "submit-manual",
      brandId,
      operationId: randomUUID(),
      questionText: "工业设备怎么选型？",
      answerText: "二次复核仍未提及协作品牌。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://auth-opt/2",
      collectorId: owner.id,
      contested: false,
      brandName: brandFields.name,
      aliases: brandFields.aliases,
      officialWebsite: brandFields.website,
      mentioned: "false",
      recommended: "false",
      officialSiteCited: "false",
    }, clock);
    assert.equal(obs2.error, undefined);

    // Owner generates first task; member merges second evidence into the same open task.
    const ownerGen = await generateFromEvidence(db, owner.id, {
      action: "generate-from-evidence",
      brandId,
      operationId: randomUUID(),
      observationId: obs1.observation.id,
      businessImportance: 2,
    }, clock, cache);
    assert.equal(ownerGen.error, undefined);
    assert.equal(ownerGen.tasks.length, 1);
    assert.equal(ownerGen.tasks[0].merged, false);
    const taskId = ownerGen.tasks[0].taskId;

    const memberGen = await generateFromEvidence(db, member.id, {
      action: "generate-from-evidence",
      brandId,
      operationId: randomUUID(),
      observationId: obs2.observation.id,
      businessImportance: 2,
    }, clock, cache);
    assert.equal(memberGen.error, undefined);
    assert.equal(memberGen.tasks.length, 1);
    assert.equal(memberGen.tasks[0].merged, true);
    assert.equal(memberGen.tasks[0].taskId, taskId);

    // Member updates task status, runs page checks, and creates a linked Brief.
    const memberUpdate = await updateTask(db, member.id, {
      action: "update-task",
      brandId,
      taskId,
      operationId: randomUUID(),
      status: "doing",
      completionNote: "成员已开始处理该缺口",
    }, clock, cache);
    assert.equal(memberUpdate.error, undefined);
    assert.equal(memberUpdate.task.status, "doing");

    const memberCheck = await checkPages(db, member.id, {
      action: "check-pages",
      brandId,
      operationId: randomUUID(),
      taskId,
      urls: ["https://collab.example.com/guide"],
      fixtures: [{
        url: "https://collab.example.com/guide",
        status: "ok",
        title: "Guide",
        body: "协作品牌说明",
      }],
    }, clock, cache);
    assert.equal(memberCheck.error, undefined);
    assert.equal(memberCheck.checks[0].publicStatus, "reachable");

    const memberDetail = await readTaskDetail(db, member.id, taskId);
    assert.equal(memberDetail.error, undefined);
    assert.equal(memberDetail.task.status, "doing");
    assert.equal(memberDetail.findings.length, 2);
    assert.equal(memberDetail.checks.length, 1);

    const brief = await saveBriefDraft(db, member.id, {
      action: "save-brief-draft",
      brandId,
      operationId: randomUUID(),
      optimizationTaskId: taskId,
      questionCluster: memberDetail.task.questionCluster,
      fields: {
        audience: "工业采购",
        targetGap: "补充选型说明",
        applicableBoundary: "仅限标准型号",
        primaryPage: "https://collab.example.com/guide",
        conversionAction: "预约演示",
        templateKind: "fact_faq",
        titleCandidates: ["协作品牌选型说明"],
        factVersionIds: [],
        competitorSource: null,
      },
    }, clock);
    assert.equal(brief.error, undefined);

    // Member can create, list, confirm, and dismiss action drafts.
    const fetchImpl = async () => new Response(JSON.stringify({
      id: "resp_loopback",
      status: "completed",
      model: "loopback-model",
      output: [{
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            observedGap: "样本未提及品牌",
            hypothesis: "原因尚待验证",
            gapType: "key_content_missing",
          }),
        }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });

    const drafted = await draftFromEvidence(db, member.id, {
      action: "draft-from-evidence",
      brandId,
      operationId: randomUUID(),
      evidenceIds: [obs1.observation.id],
    }, { clock, env, fetchImpl, cache });
    assert.equal(drafted.error, undefined);

    const draftedForDismiss = await draftFromEvidence(db, member.id, {
      action: "draft-from-evidence",
      brandId,
      operationId: randomUUID(),
      evidenceIds: [obs2.observation.id],
    }, { clock, env, fetchImpl, cache });
    assert.equal(draftedForDismiss.error, undefined);

    // read_only can view task list, task detail, and action drafts, but writes return FORBIDDEN.
    const roList = await listPrioritizedTasks(db, readOnly.id, brandId, 10);
    assert.equal(roList.error, undefined);
    assert.equal(roList.tasks.length, 1);
    assert.equal(roList.tasks[0].id, taskId);

    const roDetail = await readTaskDetail(db, readOnly.id, taskId);
    assert.equal(roDetail.error, undefined);
    assert.equal(roDetail.task.id, taskId);
    assert.equal(roDetail.checks.length, 1);

    const roDrafts = await listActionDrafts(db, readOnly.id, brandId);
    assert.equal(roDrafts.error, undefined);
    assert.equal(roDrafts.drafts.length, 2);

    assert.equal((await generateFromEvidence(db, readOnly.id, {
      action: "generate-from-evidence",
      brandId,
      operationId: randomUUID(),
      observationId: obs1.observation.id,
      businessImportance: 2,
    }, clock, cache)).error, "FORBIDDEN");

    assert.equal((await checkPages(db, readOnly.id, {
      action: "check-pages",
      brandId,
      operationId: randomUUID(),
      taskId,
      urls: ["https://collab.example.com/guide"],
      fixtures: [{ url: "https://collab.example.com/guide", status: "ok", body: "x" }],
    }, clock, cache)).error, "FORBIDDEN");

    assert.equal((await updateTask(db, readOnly.id, {
      action: "update-task",
      brandId,
      taskId,
      operationId: randomUUID(),
      status: "blocked",
    }, clock, cache)).error, "FORBIDDEN");

    assert.equal((await draftFromEvidence(db, readOnly.id, {
      action: "draft-from-evidence",
      brandId,
      operationId: randomUUID(),
      evidenceIds: [obs1.observation.id],
    }, { clock, env, fetchImpl, cache })).error, "FORBIDDEN");

    assert.equal((await confirmActionDraft(db, readOnly.id, {
      action: "confirm-action-draft",
      brandId,
      draftId: drafted.draft.id,
      operationId: randomUUID(),
    }, { clock, cache })).error, "FORBIDDEN");

    assert.equal((await dismissActionDraft(db, readOnly.id, {
      action: "dismiss-action-draft",
      brandId,
      draftId: drafted.draft.id,
      operationId: randomUUID(),
    })).error, "FORBIDDEN");

    // Member confirms and dismisses drafts.
    const confirmed = await confirmActionDraft(db, member.id, {
      action: "confirm-action-draft",
      brandId,
      draftId: drafted.draft.id,
      operationId: randomUUID(),
    }, { clock, cache });
    assert.equal(confirmed.error, undefined);
    assert.equal(confirmed.task.id, taskId);
    assert.equal(confirmed.task.merged, true);

    const dismissed = await dismissActionDraft(db, member.id, {
      action: "dismiss-action-draft",
      brandId,
      draftId: draftedForDismiss.draft.id,
      operationId: randomUUID(),
    });
    assert.equal(dismissed.error, undefined);
    assert.equal(dismissed.draft.status, "dismissed");

    // Outsider receives NOT_FOUND across all read and write endpoints without leaking names.
    const outsiderChecks = [
      await listPrioritizedTasks(db, outsider.id, brandId, 10),
      await readTaskDetail(db, outsider.id, taskId),
      await listActionDrafts(db, outsider.id, brandId),
      await generateFromEvidence(db, outsider.id, {
        action: "generate-from-evidence",
        brandId,
        operationId: randomUUID(),
        observationId: obs1.observation.id,
        businessImportance: 2,
      }, clock, cache),
      await checkPages(db, outsider.id, {
        action: "check-pages",
        brandId,
        operationId: randomUUID(),
        taskId,
        urls: ["https://collab.example.com/guide"],
        fixtures: [{ url: "https://collab.example.com/guide", status: "ok", body: "x" }],
      }, clock, cache),
      await updateTask(db, outsider.id, {
        action: "update-task",
        brandId,
        taskId,
        operationId: randomUUID(),
        status: "blocked",
      }, clock, cache),
      await draftFromEvidence(db, outsider.id, {
        action: "draft-from-evidence",
        brandId,
        operationId: randomUUID(),
        evidenceIds: [obs1.observation.id],
      }, { clock, env, fetchImpl, cache }),
      await confirmActionDraft(db, outsider.id, {
        action: "confirm-action-draft",
        brandId,
        draftId: drafted.draft.id,
        operationId: randomUUID(),
      }, { clock, cache }),
      await dismissActionDraft(db, outsider.id, {
        action: "dismiss-action-draft",
        brandId,
        draftId: drafted.draft.id,
        operationId: randomUUID(),
      }),
    ];
    for (const check of outsiderChecks) {
      assert.equal(check.error, "NOT_FOUND");
      const text = JSON.stringify(check);
      assert.equal(text.includes(brandFields.name), false);
      assert.equal(text.includes("缺席"), false);
    }

    // Revoking member grant immediately revokes both read and write access.
    const revoked = await revokeBrandGrant(db, owner.id, memberGrant.grant.id, time);
    assert.equal(revoked.error, undefined);
    assert.equal((await listPrioritizedTasks(db, member.id, brandId, 10)).error, "NOT_FOUND");
    assert.equal((await readTaskDetail(db, member.id, taskId)).error, "NOT_FOUND");
    assert.equal((await updateTask(db, member.id, {
      action: "update-task",
      brandId,
      taskId,
      operationId: randomUUID(),
      status: "blocked",
    }, clock, cache)).error, "NOT_FOUND");
  });
}
