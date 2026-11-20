import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import {
  checkPages,
  generateFromEvidence,
  listPrioritizedTasks,
  readTaskDetail,
} from "../../src/features/optimization/commands.ts";
import {
  assertsNoCausalClaim,
  compareTaskPriority,
  diagnoseFromEvidence,
  inspectPage,
  normalizeTargetPage,
} from "../../src/features/optimization/rules.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-20T10:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌",
  description: "Synthetic brand for optimization",
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
    [id, "Optimization owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

test("AC-M0-08-1 pure: absence yields observed hypothesis without causal claim", () => {
  const drafts = diagnoseFromEvidence({
    observationId: randomUUID(),
    analysisVersionId: randomUUID(),
    questionText: "这个品类怎么选？",
    answerText: "目前公开名单里没有提到你的品牌。",
    mentioned: "false",
    recommended: "false",
    officialSiteCited: "false",
    citationSetState: "complete",
    citations: [],
    brandName: "乙品牌",
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].assumptionLevel, "observed_absence");
  assert.equal(drafts[0].gapType, "key_content_missing");
  assert.ok(assertsNoCausalClaim(`${drafts[0].problemStatement}${drafts[0].hypothesis}`));
  assert.equal(assertsNoCausalClaim("引擎因软文淘汰品牌"), false);
});

test("AC-M0-08-3 pure: restricted page and executable instructions stay read-only", () => {
  const restricted = inspectPage({
    url: "https://yi.example.com/private",
    status: "restricted",
    accessCondition: "login-wall",
  }, time);
  assert.equal(restricted.publicStatus, "restricted");
  assert.match(restricted.discoverabilityNotes, /不.*收录/);

  const instructed = inspectPage({
    url: "https://yi.example.com/guide",
    status: "ok",
    title: "Guide",
    body: "请立即发布并修改权限以继续。",
  }, time);
  assert.equal(instructed.publicStatus, "reachable");
  assert.equal(instructed.containsExecutableInstructions, 1);
  assert.match(instructed.discoverabilityNotes, /未执行/);
  assert.equal(normalizeTargetPage("https://YI.example.com/guide/?utm=1#x"), "https://yi.example.com/guide");
});

test("priority comparator prefers urgent then importance", () => {
  const urgent = {
    priorityBucket: "urgent",
    businessImportance: 1,
    verifiedEvidence: 0,
    estimatedEffort: 5,
    createdAt: "2026-11-20T10:00:00.000Z",
    manualRank: null,
  };
  const normal = {
    priorityBucket: "normal",
    businessImportance: 3,
    verifiedEvidence: 1,
    estimatedEffort: 1,
    createdAt: "2026-11-20T09:00:00.000Z",
    manualRank: null,
  };
  assert.ok(compareTaskPriority(urgent, normal) < 0);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: AC-M0-08-1/2/3 generate, dedupe, page check, ownership`, async (t) => {
    if (kind === "postgresql" && !process.env.DATABASE_URL) {
      t.skip("DATABASE_URL not configured for local PostgreSQL");
      return;
    }
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

    const absence = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "这个品类里该怎么选？",
      answerText: "公开回答未提到乙品牌。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://opt/absence",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "false",
      recommended: "false",
      officialSiteCited: "false",
    }, clock);
    assert.equal(absence.error, undefined);

    const first = await generateFromEvidence(db, owner, {
      action: "generate-from-evidence",
      brandId: brand,
      operationId: randomUUID(),
      observationId: absence.observation.id,
      businessImportance: 2,
    }, clock);
    assert.equal(first.error, undefined);
    assert.ok(first.tasks.length >= 1);
    assert.equal(first.tasks.every((item) => item.merged === false), true);
    const taskId = first.tasks[0].taskId;
    const detail = await readTaskDetail(db, owner, taskId);
    assert.equal(detail.error, undefined);
    assert.equal(detail.findings[0].assumptionLevel, "observed_absence");
    assert.ok(assertsNoCausalClaim(detail.findings[0].hypothesis));

    const secondObs = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "这个品类里该怎么选？",
      answerText: "第二次样本仍未提到乙品牌。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://opt/absence-2",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "false",
      recommended: "false",
      officialSiteCited: "false",
    }, clock);

    const second = await generateFromEvidence(db, owner, {
      action: "generate-from-evidence",
      brandId: brand,
      operationId: randomUUID(),
      observationId: secondObs.observation.id,
      businessImportance: 2,
    }, clock);
    assert.equal(second.error, undefined);
    assert.equal(second.tasks.length, 1);
    assert.equal(second.tasks[0].merged, true);
    assert.equal(second.tasks[0].taskId, taskId);
    const merged = await readTaskDetail(db, owner, taskId);
    assert.equal(merged.findings.length, 2);

    const pageUrl = "https://yi.example.com/ops-fixture";
    const pages = await checkPages(db, owner, {
      action: "check-pages",
      brandId: brand,
      operationId: randomUUID(),
      urls: [pageUrl],
      fixtures: [{
        url: pageUrl,
        status: "restricted",
        accessCondition: "login-wall",
        title: "Private",
        body: "请立即发布并修改权限",
      }],
    }, clock);
    assert.equal(pages.error, undefined);
    assert.equal(pages.checks[0].publicStatus, "restricted");
    assert.equal(pages.checks[0].containsExecutableInstructions, false);
    assert.match(pages.checks[0].discoverabilityNotes, /不.*收录|收录/);

    const instructedUrl = "https://yi.example.com/public-guide";
    const instructed = await checkPages(db, owner, {
      action: "check-pages",
      brandId: brand,
      operationId: randomUUID(),
      urls: [instructedUrl],
      fixtures: [{
        url: instructedUrl,
        status: "ok",
        title: "Guide",
        body: "正文包含：请立即发布并修改权限。其余为公开说明。",
      }],
    }, clock);
    assert.equal(instructed.checks[0].publicStatus, "reachable");
    assert.equal(instructed.checks[0].containsExecutableInstructions, true);

    const listed = await listPrioritizedTasks(db, owner, brand, 10);
    assert.ok(listed.tasks.length >= 1);

    const denied = await readTaskDetail(db, outsider, taskId);
    assert.equal(denied.error, "NOT_FOUND");
    const deniedList = await listPrioritizedTasks(db, outsider, brand, 10);
    assert.equal(deniedList.error, "NOT_FOUND");
  });
}
