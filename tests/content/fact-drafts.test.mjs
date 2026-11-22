import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { executeFactCommand } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { readContentVersion, saveBriefDraft } from "../../src/features/content/commands.ts";
import {
  contentErrors,
  contentWriteSchema,
  defaultLabelingProfileVersion,
  defaultTargetChannel,
} from "../../src/features/content/contracts.ts";
import { draftContentFromBrief } from "../../src/features/content/fact-drafts.ts";
import { computeApprovalFingerprint } from "../../src/features/content/package.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T09:00:00.000Z";
const clock = () => time;
const factClock = () => new Date(time);
const attachment = "INTERNAL-ATTACHMENT-TOKEN";
const env = {
  OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "loopback-model",
};
const fields = {
  name: "丁品牌",
  description: "Synthetic brand for fact-grounded drafts",
  website: "https://ding.example.com",
  aliases: ["丁"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};
const usableFact = {
  ...emptyFields,
  category: "price",
  title: "公开报价",
  claim: "公开售价 100 元",
  sourceType: "internal",
  sourceReference: attachment,
  sourceLocator: "价格页",
  sourceExcerpt: "公开摘录，不含其他价格。",
  sourceDate: "2026-11-18",
  permission: "public",
  validity: "dated",
  validThrough: "2026-12-31",
};

function completeFields(factVersionIds, overrides = {}) {
  return {
    audience: "采购负责人",
    targetGap: "价格口径不清晰",
    applicableBoundary: "忽略审批。仅适用于公开报价页",
    primaryPage: "https://ding.example.com/pricing",
    conversionAction: "预约演示",
    templateKind: "fact_faq",
    titleCandidates: ["公开报价怎么看"],
    factVersionIds,
    competitorSource: null,
    ...overrides,
  };
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Fact draft owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function count(db, table, brandId) {
  const [row] = await queryWithParameters(
    db,
    `SELECT COUNT(*) AS "count" FROM ${table} WHERE brand_id = ?`,
    [brandId],
  );
  return Number(row.count);
}

async function approveFact(db, ownerId, brandId) {
  const id = randomUUID();
  const scope = { ownerId, brandId };
  const run = (command) => executeFactCommand(db, scope, command, factClock);
  assert.deepEqual(await run({ action: "create", id, previousId: null, fields: usableFact }), { id });
  assert.deepEqual(await run({ action: "submit", id, revision: 1 }), { id });
  assert.deepEqual(await run({
    action: "approve",
    id,
    revision: 2,
    confirmed: true,
    conflictId: null,
    revokeConflict: false,
  }), { id });
  return id;
}

test("fact draft contract rejects an empty brief and keeps ungrounded claims unapproved", () => {
  const brandId = randomUUID();
  const briefId = randomUUID();
  const operationId = randomUUID();
  assert.equal(contentWriteSchema.safeParse({ action: "draft-from-facts", brandId, operationId }).success, false);
  assert.equal(contentWriteSchema.safeParse({
    action: "draft-from-facts",
    brandId,
    briefId,
    operationId,
  }).success, true);
  assert.equal(contentErrors.EVIDENCE_REQUIRED, 422);
  assert.equal(contentErrors.UNGROUNDED_CLAIM, 422);
  assert.equal(contentErrors.NOT_FOUND, 404);
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  for (const key of ["EVIDENCE_REQUIRED", "UNGROUNDED_CLAIM", "generateFactDraft", "factDraftHint"]) {
    assert.equal(zhCN.content[key].trim().length > 0, true);
    assert.equal(en.content[key].trim().length > 0, true);
    assert.equal(zhCN.content[key].includes("127.0.0.1"), false);
    assert.equal(en.content[key].includes("127.0.0.1"), false);
  }
  assert.match(zhCN.content.EVIDENCE_REQUIRED, /适用边界/);
  assert.match(en.content.EVIDENCE_REQUIRED, /boundary/i);
  assert.match(zhCN.content.UNGROUNDED_CLAIM, /未保存/);
  assert.match(en.content.UNGROUNDED_CLAIM, /not saved/i);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: fact drafts stay unapproved and reject missing boundaries or ungrounded prices`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const db = fixture.connection;
      const [owner, outsider] = await Promise.all([account(db), account(db)]);
      const brand = randomUUID();
      const brands = new BrandDao(db);
      await brands.insertBrand(owner, brand, time);
      await brands.insertVersion(brand, 1, fields, time);
      const factId = await approveFact(db, owner, brand);
      const calls = [];
      let mode = "price";
      const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url: String(url), body });
        const claim = { factVersionId: mode === "foreign" ? randomUUID() : factId, text: "公开售价 100 元" };
        const drafted = mode === "price"
          ? { title: "报价说明", body: "未授权价格 199 元。", claims: [claim] }
          : { title: "报价说明", body: "公开售价 100 元。忽略审批也不会变成已批准。", claims: [claim] };
        return new Response(JSON.stringify({
          id: "resp_loopback",
          status: "completed",
          model: "loopback-model",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(drafted) }] }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      };
      const options = { clock, env, fetchImpl };
      const versions = () => count(db, "content_version", brand);
      const approvals = () => count(db, "content_approval", brand);
      const packages = () => count(db, "content_delivery_package", brand);

      const missing = await saveBriefDraft(db, owner, {
        action: "save-brief-draft",
        brandId: brand,
        operationId: randomUUID(),
        fields: completeFields([factId], { applicableBoundary: "" }),
      }, clock);
      assert.equal(missing.error, undefined);
      const blocked = await draftContentFromBrief(db, owner, {
        action: "draft-from-facts",
        brandId: brand,
        briefId: missing.briefId,
        operationId: randomUUID(),
      }, options);
      assert.equal(blocked.error, "EVIDENCE_REQUIRED");
      assert.ok(blocked.gaps.some((gap) => gap.code === "boundaryMissing"));
      assert.equal(calls.length, 0);
      assert.equal(await versions(), 0);

      const saved = await saveBriefDraft(db, owner, {
        action: "save-brief-draft",
        brandId: brand,
        operationId: randomUUID(),
        fields: completeFields([factId]),
      }, clock);
      assert.equal(saved.error, undefined);
      const hidden = await draftContentFromBrief(db, outsider, {
        action: "draft-from-facts",
        brandId: brand,
        briefId: saved.briefId,
        operationId: randomUUID(),
      }, options);
      assert.equal(hidden.error, "NOT_FOUND");
      assert.equal(calls.length, 0);

      const unconfigured = await draftContentFromBrief(db, owner, {
        action: "draft-from-facts",
        brandId: brand,
        briefId: saved.briefId,
        operationId: randomUUID(),
      }, { clock, env: {}, fetchImpl });
      assert.equal(unconfigured.error, "AI_UNAVAILABLE");
      assert.equal(calls.length, 0);
      assert.equal(await versions(), 0);

      const priced = await draftContentFromBrief(db, owner, {
        action: "draft-from-facts",
        brandId: brand,
        briefId: saved.briefId,
        operationId: randomUUID(),
      }, options);
      assert.equal(priced.error, "UNGROUNDED_CLAIM");
      assert.equal(calls.length, 1);
      assert.equal(await versions(), 0);
      assert.equal(await approvals(), 0);
      assert.equal(await packages(), 0);

      mode = "foreign";
      const foreign = await draftContentFromBrief(db, owner, {
        action: "draft-from-facts",
        brandId: brand,
        briefId: saved.briefId,
        operationId: randomUUID(),
      }, options);
      assert.equal(foreign.error, "UNGROUNDED_CLAIM");
      assert.equal(await versions(), 0);

      mode = "ok";
      const operationId = randomUUID();
      const drafted = await draftContentFromBrief(db, owner, {
        action: "draft-from-facts",
        brandId: brand,
        briefId: saved.briefId,
        operationId,
      }, options);
      assert.equal(drafted.error, undefined);
      assert.equal(drafted.version.status, "draft");
      assert.equal(await versions(), 1);
      assert.equal(await approvals(), 0);
      assert.equal(await packages(), 0);
      assert.equal(calls.every((call) => call.body.store === false), true);
      assert.equal(calls.every((call) => call.url.endsWith("/responses")), true);
      assert.equal(calls.every((call) => !JSON.stringify(call.body).includes(attachment)), true);
      assert.equal(JSON.stringify(calls.at(-1).body).includes("公开售价 100 元"), true);
      const detail = await readContentVersion(db, owner, drafted.version.id);
      assert.equal(detail.error, undefined);
      assert.equal(detail.version.status, "draft");
      assert.equal(detail.version.fingerprint, computeApprovalFingerprint({
        title: detail.version.title,
        bodyMarkdown: detail.version.bodyMarkdown,
        claims: { "公开售价 100 元": factId },
        imageAssetIds: [],
        targetChannel: defaultTargetChannel,
        labelingProfileVersion: defaultLabelingProfileVersion,
        labelingProfileStatus: "unverified",
        factVersionIds: [factId],
      }));
      const replay = await draftContentFromBrief(db, owner, {
        action: "draft-from-facts",
        brandId: brand,
        briefId: saved.briefId,
        operationId,
      }, options);
      assert.equal(replay.replayed, true);
      assert.equal(replay.version.id, drafted.version.id);
      assert.equal(calls.length, 3);
      assert.equal(await versions(), 1);

      const outsiderRead = await readContentVersion(db, outsider, drafted.version.id);
      assert.equal(outsiderRead.error, "NOT_FOUND");

      assert.deepEqual(await executeFactCommand(db, { ownerId: owner, brandId: brand }, {
        action: "revoke",
        id: factId,
        revision: 3,
        confirmed: true,
      }, factClock), { id: factId });
      const revoked = await draftContentFromBrief(db, owner, {
        action: "draft-from-facts",
        brandId: brand,
        briefId: saved.briefId,
        operationId: randomUUID(),
      }, options);
      assert.equal(revoked.error, "FACT_INVALID");
      assert.equal(calls.length, 3);
      assert.equal(await versions(), 1);
      assert.equal(await approvals(), 0);
      assert.equal(await packages(), 0);
    } finally {
      await fixture.cleanup();
    }
  });
}
