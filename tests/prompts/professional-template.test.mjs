import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { executePromptCommand } from "../../src/features/prompts/service.ts";
import { annotateDraft, isLeadingQuestion, isNearDuplicate, validateDraft } from "../../src/features/prompts/rules.ts";
import {
  professionalCategoryPreview,
  professionalTemplate,
  professionalTemplateNote,
} from "../../src/features/prompts/professional-template.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-26T02:00:00.000Z";
const clock = () => new Date(time);

function assertSeparated(language) {
  const rows = professionalTemplate(language);
  assert.equal(rows.length, 50);
  assert.equal(rows.filter((row) => row.type === "discovery").length, 10);
  assert.equal(rows.filter((row) => row.type === "scenario").length, 10);
  assert.equal(rows.filter((row) => row.type === "constraint").length, 10);
  assert.equal(rows.filter((row) => row.type === "comparison").length, 5);
  assert.equal(rows.filter((row) => row.type === "brand_fact").length, 5);
  assert.equal(rows.filter((row) => row.type === "exploration").length, 10);
  assert.equal(rows.every((row) => row.source === "generated" && row.sourceNote === professionalTemplateNote), true);
  assert.equal(rows.every((row) => !isLeadingQuestion(row.text) && Array.from(row.text).length >= 5), true);
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      assert.equal(isNearDuplicate(rows[left].text, rows[right].text), false, `${rows[left].key} ~ ${rows[right].key}`);
    }
  }
  const preview = professionalCategoryPreview(rows.map((row) => ({ status: "candidate", type: row.type })));
  assert.deepEqual(preview, {
    nonBrandCore: 30,
    comparison: 5,
    brandFact: 5,
    exploration: 10,
    primary: 30,
    confirmedPrimary: 0,
  });
}

test("40+10 templates keep core, comparison, brand facts, and exploration apart", () => {
  assertSeparated("zh-CN");
  assertSeparated("en");
});

function draftFrom(language, patch) {
  const clusterId = randomUUID();
  const rows = professionalTemplate(language);
  return {
    clusters: [{ id: clusterId, audience: "采购负责人", intent: "核对购买限制", primaryPage: "", conversionAction: "" }],
    questions: rows.map((row) => ({
      id: randomUUID(),
      clusterId,
      text: row.text,
      source: row.source,
      sourceNote: row.sourceNote,
      type: row.type,
      stage: row.stage,
      region: "CN",
      language: language.toLowerCase().startsWith("zh") ? "zh-CN" : "en",
      status: "candidate",
      acceptSimilar: false,
      primary: false,
      ...patch?.(row),
    })),
  };
}

test("a professional draft can be edited before freeze and the primary metric stays on non-brand core", () => {
  const edited = draftFrom("zh-CN", (row) => row.key.endsWith("-1") ? { text: "公开资料里，适用边界和排除对象要怎样分开写？" } : {});
  const saved = validateDraft(edited, [], [], "save");
  assert.equal("error" in saved, false);
  assert.equal(saved.preview.byType.discovery, 10);
  assert.equal(saved.preview.byType.comparison, 5);
  assert.equal(saved.preview.byType.brand_fact, 5);
  assert.equal(saved.preview.byType.exploration, 10);
  const confirmed = {
    ...saved.content,
    questions: saved.content.questions.map((question) => ({ ...question, status: "confirmed" })),
  };
  const frozen = validateDraft(confirmed, [], [], "freeze");
  assert.equal(frozen.preview.primary, 30);
  assert.equal(frozen.preview.saved, 50);
  assert.equal(frozen.content.questions.filter((question) => question.primary).every((question) => (
    question.type === "discovery" || question.type === "scenario" || question.type === "constraint"
  )), true);
  assert.equal(frozen.content.questions.filter((question) => (
    question.type === "comparison" || question.type === "brand_fact" || question.type === "exploration"
  )).every((question) => question.primary === false), true);

  const dropped = {
    ...confirmed,
    questions: confirmed.questions.filter((question) => question.type !== "exploration"),
  };
  const withoutExploration = validateDraft(dropped, [], [], "freeze");
  assert.equal(withoutExploration.preview.primary, 30);
  assert.equal(withoutExploration.preview.byType.exploration, 0);

  const branded = {
    ...confirmed,
    questions: confirmed.questions.map((question, index) => index === 0
      ? { ...question, text: "公开资料里，该品牌的适用边界要怎样分开写？" }
      : question),
  };
  const named = annotateDraft(branded, ["该品牌"]);
  assert.equal(professionalCategoryPreview(named.questions).primary, 29);
  assert.equal(named.questions[0].primary, false);
  assert.equal(named.questions.filter((question) => question.type === "comparison" && question.primary).length, 0);

  const quickTokens = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸", "子"];
  const quick = {
    clusters: confirmed.clusters,
    questions: quickTokens.map((token) => ({
      ...confirmed.questions[0],
      id: randomUUID(),
      text: `${token}侧快测只保留这一道购买限制`,
      source: "manual",
      sourceNote: "",
      type: "discovery",
      acceptSimilar: true,
    })),
  };
  assert.deepEqual(validateDraft(quick, [], [], "save"), { error: "notReady", adjustments: ["trim"] });
  const extraTokens = ["麒麟", "玄武", "朱雀", "白虎", "青龙", "饕餮", "鲲鹏", "貔貅", "夔牛", "烛龙", "穷奇"];
  const oversized = {
    ...confirmed,
    questions: [
      ...confirmed.questions,
      ...extraTokens.map((token) => ({
        ...confirmed.questions[0],
        id: randomUUID(),
        text: `${token}只放在探索池里观察长尾缺口`,
        type: "exploration",
        stage: "awareness",
        acceptSimilar: true,
      })),
    ],
  };
  assert.equal(validateDraft(oversized, [], [], "save").error, "notReady");
  assert.deepEqual(validateDraft(oversized, [], [], "save").adjustments, ["professionalTrim"]);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: freezing a 40+10 draft keeps only non-brand core in the primary count`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const db = fixture.connection;
      const ownerId = randomUUID();
      const brandId = randomUUID();
      await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
        ownerId, "Prompt owner", `${ownerId}@example.invalid`, db.kind === "sqlite" ? 1 : true,
      ]);
      const brands = new BrandDao(db);
      await brands.insertBrand(ownerId, brandId, time);
      await brands.insertVersion(brandId, 1, {
        ...initialBrandFields,
        name: "戊牌设备",
        description: "合成数据用于专业题集验收",
        aliases: ["戊牌"],
        competitors: ["别家设备"],
      }, time);
      const content = draftFrom("zh-CN");
      content.questions = content.questions.map((question) => ({ ...question, status: "confirmed" }));
      content.questions[0].text = "公开资料里，适用边界和排除对象要怎样分开写？";
      const frozen = await executePromptCommand(db, { ownerId, brandId }, {
        action: "freeze",
        id: randomUUID(),
        setId: randomUUID(),
        revision: null,
        baseSetId: null,
        content,
      }, clock);
      assert.equal(frozen.preview.primary, 30);
      assert.equal(frozen.preview.saved, 50);
      assert.equal(frozen.preview.byType.comparison, 5);
      assert.equal(frozen.preview.byType.brand_fact, 5);
      assert.equal(frozen.preview.byType.exploration, 10);
      assert.equal(frozen.content.questions.some((question) => question.text === content.questions[0].text && question.primary), true);
    } finally {
      await fixture.cleanup();
    }
  });
}
