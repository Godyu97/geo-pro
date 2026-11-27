import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  confirmCaptureAttempt,
  createCaptureSheet,
  degradeCaptureSheet,
  getCaptureSheet,
  listCaptureSheets,
  readCaptureWorkspace,
  recordCaptureAttempt,
} from "../../src/features/assisted-capture/commands.ts";
import {
  captureErrors,
  confirmCaptureAttemptSchema,
  createCaptureSheetSchema,
  degradeCaptureSheetSchema,
  recordCaptureAttemptSchema,
} from "../../src/features/assisted-capture/contracts.ts";
import { captureAttemptListQuery, captureSheetListQuery } from "../../src/features/assisted-capture/dao.ts";
import { degradeEntry, effortComparison } from "../../src/features/assisted-capture/effort.ts";
import { assistedCapture, confirmCapture } from "../../src/features/assisted-capture/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { completeManualEvidence, readObservation } from "../../src/features/evidence/commands.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import { PromptDao } from "../../src/features/prompts/dao.ts";
import { memoryCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";
const secret = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("capture input rejects credentials and keeps a login wall from becoming complete", () => {
  assert.equal(captureErrors.NOT_FOUND, 404);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const base = {
    brandId,
    promptIds: [` ${secret} `, second],
    assistedMinutes: 12,
    manualMinutes: 30,
    citationsComplete: true,
  };
  assert.equal(createCaptureSheetSchema.safeParse({ ...base, password: "secret" }).success, false);
  assert.equal(createCaptureSheetSchema.safeParse({ ...base, cookie: "session" }).success, false);
  assert.equal(createCaptureSheetSchema.safeParse({ ...base, proxy: "http://127.0.0.1" }).success, false);
  assert.equal(createCaptureSheetSchema.safeParse({ ...base, account: "owner" }).success, false);
  assert.equal(createCaptureSheetSchema.safeParse({ ...base, assistedMinutes: 100001 }).success, false);
  assert.equal(createCaptureSheetSchema.safeParse({ ...base, promptIds: [secret, secret] }).success, false);
  const parsed = createCaptureSheetSchema.safeParse(base);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.promptIds, [secret, second]);
  assert.equal(recordCaptureAttemptSchema.safeParse({
    sheetId: brandId,
    blockedBy: "login",
    citationCount: 3,
    password: "secret",
  }).success, false);
  assert.equal(recordCaptureAttemptSchema.safeParse({
    sheetId: brandId,
    blockedBy: "captcha",
    citationCount: 1001,
  }).success, false);
  assert.equal(confirmCaptureAttemptSchema.safeParse({ confirmed: true, complete: true }).success, false);
  assert.equal(degradeCaptureSheetSchema.safeParse({ structureChanged: true, promptIds: [secret] }).success, false);
  assert.deepEqual(assistedCapture({ blockedBy: "login", citationCount: 3 }), {
    status: "handoff", bypass: false, complete: false, silentEmptyCitations: false,
  });
  assert.deepEqual(confirmCapture("handoff", true), { saved: false, complete: false });
  assert.deepEqual(confirmCapture("partial", true), { saved: true, complete: false });
  assert.deepEqual(effortComparison({ assistedMinutes: null, manualMinutes: 30, citationsComplete: true }), {
    savedMinutes: null, comparable: false,
  });
  assert.deepEqual(degradeEntry({ structureChanged: true }), {
    mode: "manual", manualStillAvailable: true, switchedAccount: false,
  });
});

test("capture copy stops at a login wall and leaves saved minutes empty when a comparison is missing", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.assistedCapture.description, /登录墙/);
  assert.match(zhCN.assistedCapture.description, /验证码/);
  assert.match(zhCN.assistedCapture.description, /不绕过/);
  assert.match(zhCN.assistedCapture.description, /partial/);
  assert.match(zhCN.assistedCapture.description, /人工/);
  assert.match(zhCN.assistedCapture.description, /题目 ID/);
  assert.match(zhCN.assistedCapture.description, /节省分钟数为空/);
  assert.match(zhCN.assistedCapture.description, /密码/);
  assert.match(en.assistedCapture.description, /login wall/i);
  assert.match(en.assistedCapture.description, /captcha/i);
  assert.match(en.assistedCapture.description, /does not bypass/i);
  assert.match(en.assistedCapture.description, /partial/);
  assert.match(en.assistedCapture.description, /manual/i);
  assert.match(en.assistedCapture.description, /question IDs/i);
  assert.match(en.assistedCapture.description, /saved minutes stay empty/i);
  assert.match(en.assistedCapture.description, /password/i);
  assert.equal(zhCN.assistedCapture.savedMinutesLine.includes("{minutes}"), true);
  assert.equal(en.assistedCapture.savedMinutesLine.includes("{minutes}"), true);
  assert.equal(zhCN.evidenceOverview.openCapture.length > 0, true);
  assert.equal(en.evidenceOverview.openCapture.length > 0, true);
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

function byId(sheet, id) {
  const found = sheet.attempts.find((attempt) => attempt.id === id);
  assert.ok(found);
  return found;
}

function captureColumns(shape) {
  if (Array.isArray(shape)) {
    return shape
      .filter((row) => row.tbl_name === "capture_sheet" || row.tbl_name === "capture_attempt")
      .map((row) => row.sql ?? "")
      .join("\n")
      .toLowerCase();
  }
  return shape.columns
    .filter((row) => row.table_name === "capture_sheet" || row.table_name === "capture_attempt")
    .map((row) => row.column_name)
    .join(",")
    .toLowerCase();
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Capture owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: a login wall stays handoff, partial stays incomplete, and another user cannot read question ids`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        assert.match(defined, /capture_sheet_owner_idx/);
        assert.match(defined, /capture_attempt_sheet_idx/);
        assert.match(defined, /capture_sheet_state_check/);
        assert.match(defined, /capture_attempt_state_check/);
        if (db.kind === "postgresql") assert.match(defined, /capture_attempt_sheet_fk/);
        else assert.match(defined, /FOREIGN KEY \(`sheet_id`\) REFERENCES `capture_sheet`/);
        const columns = captureColumns(migrated);
        for (const word of ["password", "cookie", "proxy", "account"]) {
          assert.equal(columns.includes(word), false, word);
        }

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom("2026-11-22T09:00:00.000Z");
        const promptIds = [secret, second];

        const hidden = await createCaptureSheet(db, outsider, {
          brandId: brand,
          promptIds,
          assistedMinutes: 12,
          manualMinutes: 30,
          citationsComplete: true,
        }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes(secret), false);

        const created = await createCaptureSheet(db, owner, {
          brandId: brand,
          promptIds,
          assistedMinutes: 12,
          manualMinutes: 30,
          citationsComplete: true,
        }, clock);
        assert.equal(created.sheet.mode, "assisted");
        assert.deepEqual(created.sheet.promptIds, promptIds);
        assert.equal(created.sheet.savedMinutes, 18);
        assert.equal(created.sheet.comparable, true);
        assert.equal(created.sheet.switchedAccount, false);
        assert.deepEqual(created.sheet.attempts, []);

        const missingAssisted = await createCaptureSheet(db, owner, {
          brandId: brand,
          promptIds: [randomUUID()],
          assistedMinutes: null,
          manualMinutes: 30,
          citationsComplete: true,
        }, clock);
        assert.equal(missingAssisted.sheet.savedMinutes, null);
        assert.equal(missingAssisted.sheet.comparable, false);

        const missingManual = await createCaptureSheet(db, owner, {
          brandId: brand,
          promptIds: [randomUUID()],
          assistedMinutes: 12,
          manualMinutes: null,
          citationsComplete: true,
        }, clock);
        assert.equal(missingManual.sheet.savedMinutes, null);

        const incomplete = await createCaptureSheet(db, owner, {
          brandId: brand,
          promptIds: [randomUUID()],
          assistedMinutes: 12,
          manualMinutes: 40,
          citationsComplete: false,
        }, clock);
        assert.equal(incomplete.sheet.savedMinutes, null);
        assert.equal(incomplete.sheet.citationsComplete, false);
        assert.deepEqual(effortComparison({
          assistedMinutes: 12,
          manualMinutes: 40,
          citationsComplete: false,
        }).savedMinutes, null);

        const stayed = await degradeCaptureSheet(db, owner, missingAssisted.sheet.id, { structureChanged: false }, clock);
        assert.equal(stayed.sheet.mode, "assisted");
        assert.deepEqual(stayed.sheet.promptIds, missingAssisted.sheet.promptIds);

        const loginWatch = watch(db);
        const login = await recordCaptureAttempt(loginWatch.connection, owner, {
          sheetId: created.sheet.id,
          blockedBy: "login",
          citationCount: 3,
        }, clock);
        const loginAttempt = login.sheet.attempts[0];
        assert.equal(loginAttempt.status, "handoff");
        assert.equal(loginAttempt.bypass, false);
        assert.equal(loginAttempt.complete, false);
        assert.equal(loginAttempt.confirmed, false);
        assert.equal(loginAttempt.silentEmptyCitations, false);
        const loginInsert = loginWatch.captured.find((item) => /insert into capture_attempt\b/i.test(item.sql));
        assert.equal(loginInsert.values[4], "login");
        assert.equal(loginInsert.values[6], "handoff");
        assert.equal(loginInsert.values[7], 0);
        assert.equal(/password|cookie|proxy/i.test(loginInsert.sql), false);

        const confirmWatch = watch(db);
        const confirmedLogin = await confirmCaptureAttempt(confirmWatch.connection, owner, loginAttempt.id, { confirmed: true }, clock);
        const stillHandoff = byId(confirmedLogin.sheet, loginAttempt.id);
        assert.equal(stillHandoff.status, "handoff");
        assert.equal(stillHandoff.confirmed, false);
        assert.equal(stillHandoff.complete, false);
        assert.equal(stillHandoff.saved, false);
        assert.equal(confirmWatch.captured.some((item) => /update capture_attempt/i.test(item.sql)), false);
        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE capture_attempt SET confirmed = 1, updated_at = ? WHERE id = ?`,
            [time, loginAttempt.id],
          ),
          /CHECK|check constraint/i,
        );

        const partial = await recordCaptureAttempt(db, owner, {
          sheetId: created.sheet.id,
          blockedBy: null,
          citationCount: 0,
        }, clock);
        const partialAttempt = partial.sheet.attempts.find((attempt) => attempt.status === "partial");
        assert.equal(partialAttempt.complete, false);
        assert.equal(partialAttempt.silentEmptyCitations, false);
        const partialWatch = watch(db);
        const confirmedPartial = await confirmCaptureAttempt(partialWatch.connection, owner, partialAttempt.id, { confirmed: true }, clock);
        const savedPartial = byId(confirmedPartial.sheet, partialAttempt.id);
        assert.equal(savedPartial.status, "partial");
        assert.equal(savedPartial.confirmed, true);
        assert.equal(savedPartial.saved, true);
        assert.equal(savedPartial.complete, false);
        const partialUpdate = partialWatch.captured.find((item) => /update capture_attempt/i.test(item.sql));
        assert.equal(partialUpdate.values[0], 1);
        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE capture_attempt SET status = 'preview', updated_at = ? WHERE id = ?`,
            [time, partialAttempt.id],
          ),
          /CHECK|check constraint/i,
        );

        const preview = await recordCaptureAttempt(db, owner, {
          sheetId: created.sheet.id,
          blockedBy: null,
          citationCount: 2,
        }, clock);
        const previewAttempt = preview.sheet.attempts.find((attempt) => attempt.citationCount === 2);
        assert.equal(previewAttempt.status, "preview");
        assert.equal(previewAttempt.complete, false);
        const confirmedPreview = await confirmCaptureAttempt(db, owner, previewAttempt.id, { confirmed: true }, clock);
        const savedPreview = byId(confirmedPreview.sheet, previewAttempt.id);
        assert.equal(savedPreview.complete, true);
        assert.equal(savedPreview.saved, true);
        assert.equal(confirmCapture("preview", true).complete, true);

        const degradeWatch = watch(db);
        const degraded = await degradeCaptureSheet(degradeWatch.connection, owner, created.sheet.id, { structureChanged: true }, clock);
        assert.equal(degraded.sheet.mode, "manual");
        assert.deepEqual(degraded.sheet.promptIds, promptIds);
        assert.equal(degraded.sheet.switchedAccount, false);
        assert.equal(degraded.sheet.manualStillAvailable, true);
        assert.equal(degraded.sheet.savedMinutes, 18);
        const modeUpdate = degradeWatch.captured.find((item) => /update capture_sheet/i.test(item.sql));
        assert.match(modeUpdate.sql, /\bmode\b/);
        assert.doesNotMatch(modeUpdate.sql, /prompt_ids_json/);
        const manual = await recordCaptureAttempt(db, owner, {
          sheetId: created.sheet.id,
          blockedBy: null,
          citationCount: 4,
        }, clock);
        assert.equal(manual.sheet.mode, "manual");
        assert.deepEqual(manual.sheet.promptIds, promptIds);
        assert.equal(manual.sheet.attempts.at(-1).status, "preview");
        assert.equal(manual.sheet.switchedAccount, false);

        await assert.rejects(
          () => queryWithParameters(
            db,
            `UPDATE capture_sheet SET assisted_minutes = 100001, updated_at = ? WHERE id = ?`,
            [time, created.sheet.id],
          ),
          /CHECK|check constraint/i,
        );

        const deniedWatch = watch(db);
        const denied = await getCaptureSheet(deniedWatch.connection, outsider, created.sheet.id);
        assert.deepEqual(denied, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(denied).includes(secret), false);
        assert.equal(deniedWatch.captured.some((item) => (item.values ?? []).includes(secret)), false);
        const outsiderConfirm = await confirmCaptureAttempt(db, outsider, loginAttempt.id, { confirmed: true }, clock);
        assert.deepEqual(outsiderConfirm, { error: "NOT_FOUND" });
        const outsiderDegrade = await degradeCaptureSheet(db, outsider, missingManual.sheet.id, { structureChanged: true }, clock);
        assert.deepEqual(outsiderDegrade, { error: "NOT_FOUND" });
        const stillAssisted = await getCaptureSheet(db, owner, missingManual.sheet.id);
        assert.equal(stillAssisted.sheet.mode, "assisted");
        assert.equal(stillAssisted.sheet.promptIds.includes(secret), false);

        const ownerRead = await getCaptureSheet(db, owner, created.sheet.id);
        assert.equal(ownerRead.sheet.promptIds.includes(secret), true);
        const listWatch = watch(db);
        const listed = await listCaptureSheets(listWatch.connection, owner, brand);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "capture_sheet")).length, 1);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "capture_attempt")).length, 1);
        assert.equal(listed.sheets.find((sheet) => sheet.id === created.sheet.id).promptIds.includes(secret), true);
        const listValues = listWatch.captured.find((item) => isSelect(item.sql, "capture_attempt")).values;
        assert.equal(listValues.includes(secret), false);
        assert.equal(listValues.includes(owner), true);
        const outsiderWatch = watch(db);
        const outsiderList = await listCaptureSheets(outsiderWatch.connection, outsider, brand);
        assert.deepEqual(outsiderList, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(outsiderList).includes(secret), false);
        assert.equal(outsiderWatch.captured.some((item) => /\bcapture_sheet\b/i.test(item.sql)), false);
        assert.equal(outsiderWatch.captured.some((item) => /\bcapture_attempt\b/i.test(item.sql)), false);

        const extraBrands = Array.from({ length: 200 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
           VALUES ${extraBrands.map(() => "(?, ?, 'archived', 1, 1, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, outsider, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO capture_sheet (
            id, brand_id, owner_id, prompt_ids_json, mode, assisted_minutes, manual_minutes,
            citations_complete, created_at, updated_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, 'assisted', NULL, NULL, 1, ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [id, id, outsider, JSON.stringify([id]), time, time]),
        );
        await queryWithParameters(
          db,
          `INSERT INTO capture_attempt (
            id, sheet_id, brand_id, owner_id, blocked_by, citation_count, status, confirmed, created_at, updated_at
          ) VALUES ${extraBrands.map(() => "(?, ?, ?, ?, NULL, 1, 'preview', 0, ?, ?)").join(", ")}`,
          extraBrands.flatMap((id) => [randomUUID(), id, id, outsider, time, time]),
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE capture_sheet");
          await db.query("ANALYZE capture_attempt");
        }
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const listQuery = captureSheetListQuery(owner, brand);
        const attemptQuery = captureAttemptListQuery(owner, created.sheet.id);
        const listPlan = JSON.stringify(await queryWithParameters(db, explain + listQuery.sql, listQuery.values));
        const attemptPlan = JSON.stringify(await queryWithParameters(db, explain + attemptQuery.sql, attemptQuery.values));
        assert.match(listPlan, /capture_sheet_owner_idx/);
        assert.match(attemptPlan, /capture_attempt_sheet_idx/);
        if (db.kind === "postgresql") {
          assert.doesNotMatch(listPlan, /Seq Scan on capture_sheet(?!_)/);
          assert.doesNotMatch(attemptPlan, /Seq Scan on capture_attempt/);
        }
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${kind}: confirming capture writes consumer_ui evidence, enforces partial/handoff boundaries, and respects group roles`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const db = fixture.connection;
      const cache = memoryCache();
      const [owner, member, readonlyUser, outsider] = await Promise.all([
        account(db),
        account(db),
        account(db),
        account(db),
      ]);
      const brand = randomUUID();
      const brands = new BrandDao(db);
      await brands.insertBrand(owner, brand, time);
      await brands.insertVersion(brand, 1, {
        name: "GeoPro 消费者测试",
        description: "用于消费者轨道辅助采集与入证测试的品牌",
        website: "https://capture-evidence.example.com",
        aliases: ["GeoPro"],
        region: "CN",
        language: "zh-CN",
        competitors: [],
        questions: [],
      }, time);

      await queryWithParameters(
        db,
        `INSERT INTO brand_member_grant (id, user_id, brand_id, role, active, expires_at, created_at, revoked_at)
         VALUES (?, ?, ?, 'owner', 1, NULL, ?, NULL), (?, ?, ?, 'member', 1, NULL, ?, NULL), (?, ?, ?, 'read_only', 1, NULL, ?, NULL)`,
        [randomUUID(), owner, brand, time, randomUUID(), member, brand, time, randomUUID(), readonlyUser, brand, time],
      );

      const promptIdA = randomUUID();
      const promptIdB = randomUUID();
      const clusterId = randomUUID();
      const promptSetId = randomUUID();
      const setId = randomUUID();
      const promptDao = new PromptDao(db, brand);
      await promptDao.insertSet({
        id: promptSetId,
        setId,
        version: 1,
        entityVersion: 1,
        region: "CN",
        language: "zh-CN",
        content: {
          clusters: [{
            id: clusterId,
            audience: "运营团队",
            intent: "评估工具",
            primaryPage: "https://capture-evidence.example.com",
            conversionAction: "咨询试用",
          }],
          questions: [
            {
              id: promptIdA,
              text: "消费者入口评估 GeoPro 的核心依据是什么",
              type: "discovery",
              clusterId,
              source: "manual",
              sourceNote: "",
              stage: "consider",
              region: "CN",
              language: "zh-CN",
              status: "confirmed",
              acceptSimilar: true,
              primary: true,
            },
            {
              id: promptIdB,
              text: "消费者入口如何核对品牌官网引用",
              type: "discovery",
              clusterId,
              source: "manual",
              sourceNote: "",
              stage: "compare",
              region: "CN",
              language: "zh-CN",
              status: "confirmed",
              acceptSimilar: true,
              primary: false,
            },
          ],
        },
        createdAt: time,
      });

      const clock = clockFrom("2026-11-27T08:00:00.000Z");

      // Prime consumer_ui overview cache first so invalidation is exercised.
      const beforeOverview = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "consumer_ui" }, cache, clock);
      assert.equal(beforeOverview.answers.length, 0);

      // Member reads workspace with frozen prompt sets and write permission.
      const memberWorkspace = await readCaptureWorkspace(db, member, brand);
      assert.equal(memberWorkspace.canWrite, true);
      assert.equal(memberWorkspace.brand?.id, brand);
      assert.equal(memberWorkspace.promptSets.length, 1);
      assert.equal(memberWorkspace.promptSets[0].questions.length, 2);

      // Read-only user sees workspace as read-only and is forbidden from writing.
      const readonlyWorkspace = await readCaptureWorkspace(db, readonlyUser, brand);
      assert.equal(readonlyWorkspace.canWrite, false);
      assert.equal(readonlyWorkspace.brand?.id, brand);
      assert.deepEqual(
        await createCaptureSheet(db, readonlyUser, {
          brandId: brand,
          promptIds: [promptIdA],
          assistedMinutes: 5,
          manualMinutes: 15,
          citationsComplete: true,
        }, clock),
        { error: "FORBIDDEN" },
      );

      // Outsider gets NOT_FOUND.
      assert.deepEqual(await readCaptureWorkspace(db, outsider, brand), { error: "NOT_FOUND" });

      // Member creates frozen capture sheet from frozen prompt set.
      const created = await createCaptureSheet(db, member, {
        brandId: brand,
        promptIds: [promptIdA, promptIdB],
        assistedMinutes: 6,
        manualMinutes: 18,
        citationsComplete: true,
      }, clock);
      assert.ok("sheet" in created);
      const sheetId = created.sheet.id;

      // Credential text in answer/locator is rejected.
      assert.deepEqual(
        await recordCaptureAttempt(db, member, {
          sheetId,
          blockedBy: null,
          citationCount: 1,
          promptId: promptIdA,
          answerText: "session_token=secret",
          citations: ["https://capture-evidence.example.com/docs"],
        }, clock),
        { error: "INVALID_INPUT" },
      );

      // Handoff (login) with answerText stays handoff and never writes an observation.
      const handoffRes = await recordCaptureAttempt(db, member, {
        sheetId,
        blockedBy: "login",
        citationCount: 1,
        promptId: promptIdA,
        answerText: "登录墙阻断样本不应入证",
      }, clock);
      assert.ok("sheet" in handoffRes);
      const handoffAttempt = handoffRes.sheet.attempts.at(-1);
      assert.equal(handoffAttempt.status, "handoff");
      const handoffConfirm = await confirmCaptureAttempt(db, member, handoffAttempt.id, { confirmed: true }, clock, cache);
      assert.ok("sheet" in handoffConfirm);
      assert.equal(handoffConfirm.sheet.attempts.at(-1).observationId, null);

      // Preview attempt with answer, deduplicated UTM citations, locator, collector, and conditions -> writes complete consumer_ui observation.
      const previewRes = await recordCaptureAttempt(db, member, {
        sheetId,
        blockedBy: null,
        citationCount: 2,
        promptId: promptIdA,
        answerText: "GeoPro 智搜监测可核对公开网页引用，推荐使用官方来源进行复核。",
        citations: [
          "https://capture-evidence.example.com/guide?utm_source=test",
          "https://capture-evidence.example.com/guide?fbclid=dup",
        ],
        locatorRef: "consumer://chat/session-001",
        collectorId: "consumer-ui-chrome",
        requestedNetworkMode: "on",
        targetRegion: "CN",
        observedRegion: "CN",
        newSession: "true",
        productMode: "true",
      }, clock);
      assert.ok("sheet" in previewRes);
      const previewAttempt = previewRes.sheet.attempts.at(-1);
      assert.equal(previewAttempt.status, "preview");
      assert.equal(previewAttempt.questionText, "消费者入口评估 GeoPro 的核心依据是什么");

      const confirmed = await confirmCaptureAttempt(db, member, previewAttempt.id, { confirmed: true }, clock, cache);
      assert.ok("sheet" in confirmed);
      const savedAttempt = confirmed.sheet.attempts.find((item) => item.id === previewAttempt.id);
      assert.equal(savedAttempt.confirmed, true);
      assert.equal(savedAttempt.complete, true);
      assert.ok(savedAttempt.observationId);
      assert.equal(savedAttempt.observationState, "complete");
      assert.equal(savedAttempt.observationCitationState, "complete");

      // Read back observation via Evidence detail & consumer_ui overview.
      const detail = await readObservation(db, member, savedAttempt.observationId);
      assert.ok(detail);
      assert.equal(detail.observation.sourceMode, "consumer_ui");
      assert.equal(detail.observation.captureMethod, "assisted");
      assert.equal(detail.observation.questionText, "消费者入口评估 GeoPro 的核心依据是什么");
      assert.equal(detail.observation.locatorRef, "consumer://chat/session-001");
      assert.equal(detail.observation.collectorId, "consumer-ui-chrome");
      assert.equal(detail.observation.requestedNetworkMode, "on");
      assert.equal(detail.observation.observedRegion, "CN");
      assert.equal(detail.observation.newSession, "true");
      assert.equal(detail.observation.productMode, "true");
      assert.equal(detail.observation.citationSetState, "complete");
      assert.equal(detail.citations.length, 1);
      assert.equal(detail.citations[0].citationOrigin, "consumer_visible");
      assert.equal(detail.citations[0].normalizedUrl, "https://capture-evidence.example.com/guide");
      assert.equal(detail.latestAnalysis?.mentioned, "true");
      assert.equal(detail.latestAnalysis?.recommended, "true");
      assert.equal(detail.latestAnalysis?.officialSiteCited, "true");

      const afterOverview = await readEvidenceOverview(db, member, { brandId: brand, sourceMode: "consumer_ui" }, cache, clock);
      assert.equal(afterOverview.answers.some((item) => item.observationId === savedAttempt.observationId), true);

      // Partial attempt (0 citations) confirmed without supplementing stays citationSetState='partial' (not in C).
      const partialRes = await recordCaptureAttempt(db, member, {
        sheetId,
        blockedBy: null,
        citationCount: 0,
        promptId: promptIdB,
        answerText: "缺少引用链接的消费者回答样本。",
        locatorRef: "consumer://chat/session-002",
        collectorId: "consumer-ui-chrome",
      }, clock);
      assert.ok("sheet" in partialRes);
      const partialAttempt = partialRes.sheet.attempts.at(-1);
      assert.equal(partialAttempt.status, "partial");
      const confirmedPartial = await confirmCaptureAttempt(db, member, partialAttempt.id, { confirmed: true }, clock, cache);
      assert.ok("sheet" in confirmedPartial);
      const savedPartial = confirmedPartial.sheet.attempts.find((item) => item.id === partialAttempt.id);
      assert.equal(savedPartial.complete, false);
      assert.equal(savedPartial.observationCitationState, "partial");
      const partialDetail = await readObservation(db, member, savedPartial.observationId);
      assert.equal(partialDetail.citationPool.inC, false);
      assert.equal(partialDetail.citationPool.reason, "partial");

      // Partial attempt missing locatorRef saves as draft_evidence and can be completed by owner via completeManualEvidence.
      const draftRes = await recordCaptureAttempt(db, member, {
        sheetId,
        blockedBy: null,
        citationCount: 0,
        promptId: promptIdB,
        answerText: "缺少定位符的草稿样本。",
        collectorId: "consumer-ui-chrome",
      }, clock);
      assert.ok("sheet" in draftRes);
      const draftAttempt = draftRes.sheet.attempts.at(-1);
      const confirmedDraft = await confirmCaptureAttempt(db, member, draftAttempt.id, { confirmed: true }, clock, cache);
      assert.ok("sheet" in confirmedDraft);
      const savedDraft = confirmedDraft.sheet.attempts.find((item) => item.id === draftAttempt.id);
      assert.equal(savedDraft.observationState, "draft_evidence");

      const completedDraft = await completeManualEvidence(db, owner, {
        action: "complete-manual",
        brandId: brand,
        observationId: savedDraft.observationId,
        operationId: randomUUID(),
        questionText: "消费者入口如何核对品牌官网引用",
        answerText: "缺少定位符的草稿样本。",
        region: "CN",
        language: "zh-CN",
        requestedNetworkMode: "unknown",
        targetRegion: "CN",
        observedRegion: "unknown",
        newSession: "unknown",
        productMode: "unknown",
        entityVersion: 1,
        citationSetState: "complete",
        citations: [{
          rawUrl: "https://capture-evidence.example.com/supplemented",
          citationOrigin: "consumer_visible",
          positionLabel: "1",
          ownership: "unknown",
          pageStatus: "unknown",
        }],
        locatorRef: "consumer://chat/session-003",
        collectorId: "consumer-ui-chrome",
        contested: false,
        brandName: "GeoPro 消费者测试",
        aliases: ["GeoPro"],
        officialWebsite: "https://capture-evidence.example.com",
      }, clock, cache);
      assert.ok("observation" in completedDraft);
      assert.equal(completedDraft.observation.evidenceState, "complete");
      assert.equal(completedDraft.observation.captureMethod, "assisted");

      // Degraded manual sheet writes captureMethod='manual' when confirmed.
      const degraded = await degradeCaptureSheet(db, member, sheetId, { structureChanged: true }, clock);
      assert.ok("sheet" in degraded);
      assert.equal(degraded.sheet.mode, "manual");
      const manualRes = await recordCaptureAttempt(db, member, {
        sheetId,
        blockedBy: null,
        citationCount: 1,
        promptId: promptIdB,
        answerText: "结构变更后退回人工模式录入的真实回答。",
        citations: ["https://capture-evidence.example.com/manual-fallback"],
        locatorRef: "consumer://chat/manual-004",
        collectorId: "consumer-manual",
      }, clock);
      assert.ok("sheet" in manualRes);
      const manualConfirm = await confirmCaptureAttempt(db, member, manualRes.sheet.attempts.at(-1).id, { confirmed: true }, clock, cache);
      assert.ok("sheet" in manualConfirm);
      const manualObsId = manualConfirm.sheet.attempts.at(-1).observationId;
      const manualDetail = await readObservation(db, owner, manualObsId);
      assert.equal(manualDetail.observation.captureMethod, "manual");
      assert.equal(manualDetail.observation.sourceMode, "consumer_ui");
    } finally {
      await fixture.cleanup();
    }
  });
}
