import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import {
  aggregateOverviewMetrics,
  filterSamplesByScope,
} from "../../src/features/evidence/metrics.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const time = "2026-11-20T08:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌", description: "Synthetic brand for overview", website: "https://yi.example.com",
  aliases: ["乙"], region: "CN", language: "zh-CN", competitors: [], questions: [],
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json", "utf8"));
  return journal.entries.at(-2).tag;
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Overview owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true]);
  return id;
}

function sample(partial) {
  return {
    observationId: randomUUID(),
    questionKey: "q1",
    questionText: "Q1",
    questionType: "discovery",
    sourceMode: "model_api",
    region: "CN",
    requestedNetworkMode: "unknown",
    capturedAt: time,
    evidenceState: "complete",
    citationSetState: "complete",
    mentioned: "true",
    recommended: "false",
    officialSiteCited: "false",
    hasOfficialWebsite: true,
    ...partial,
  };
}

test("AC-M0-07-1 empty scope shows N/A without fabricated rates", () => {
  const metrics = aggregateOverviewMetrics([]);
  assert.equal(metrics.viewStatus, "empty");
  assert.equal(metrics.metrics.recommended.status, "na");
  assert.equal(metrics.metrics.recommended.equalWeight, null);
  assert.equal(metrics.metrics.recommended.pooled.rate, null);
});

test("AC-M0-07-2 equal-weight 75% and pooled 80% with five samples", () => {
  const samples = [
    sample({ questionKey: "q1", questionText: "题1", recommended: "true" }),
    sample({ questionKey: "q1", questionText: "题1", recommended: "false" }),
    sample({ questionKey: "q2", questionText: "题2", recommended: "true" }),
    sample({ questionKey: "q2", questionText: "题2", recommended: "true" }),
    sample({ questionKey: "q2", questionText: "题2", recommended: "true" }),
  ];
  const metrics = aggregateOverviewMetrics(samples);
  assert.equal(metrics.sampleIds.length, 5);
  assert.ok(Math.abs((metrics.metrics.recommended.equalWeight ?? 0) - 0.75) < 1e-9);
  assert.equal(metrics.metrics.recommended.pooled.numerator, 4);
  assert.equal(metrics.metrics.recommended.pooled.denominator, 5);
  assert.ok(Math.abs((metrics.metrics.recommended.pooled.rate ?? 0) - 0.8) < 1e-9);
});

test("track filter excludes the other sourceMode", () => {
  const samples = [
    sample({ sourceMode: "model_api", recommended: "true" }),
    sample({ sourceMode: "consumer_ui", recommended: "true", observationId: randomUUID() }),
  ];
  const filtered = filterSamplesByScope(samples, { sourceMode: "consumer_ui" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].sourceMode, "consumer_ui");
  const metrics = aggregateOverviewMetrics(filtered);
  assert.equal(metrics.sampleCount, 1);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: overview command ownership, empty N/A, dual-track isolation`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: ["ignore", "pipe", "pipe"] });

    const [owner, outsider] = await Promise.all([account(db), account(db)]);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);

    const empty = await readEvidenceOverview(db, owner, {
      brandId: brand,
      sourceMode: "model_api",
    });
    assert.equal("error" in empty, false);
    assert.equal(empty.viewStatus, "empty");
    assert.equal(empty.metrics.recommended.status, "na");
    assert.equal(empty.demo, false);
    assert.equal(empty.suggestions.length, 0);

    const denied = await readEvidenceOverview(db, outsider, {
      brandId: brand,
      sourceMode: "model_api",
    });
    assert.equal(denied.error, "NOT_FOUND");

    const first = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "这个品类里该怎么选？",
      answerText: "可以考虑乙品牌。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://overview/1",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "true",
      recommended: "true",
      officialSiteCited: "false",
    }, clock);
    assert.equal(first.error, undefined);

    const consumer = await submitManualEvidence(db, owner, {
      action: "submit-manual",
      brandId: brand,
      operationId: randomUUID(),
      questionText: "日常使用要注意什么？",
      answerText: "乙品牌值得考虑。",
      region: "CN",
      language: "zh-CN",
      requestedNetworkMode: "unknown",
      entityVersion: 1,
      citationSetState: "complete",
      citations: [],
      locatorRef: "fixture://overview/2",
      collectorId: owner,
      contested: false,
      brandName: "乙品牌",
      aliases: ["乙"],
      officialWebsite: "https://yi.example.com",
      mentioned: "true",
      recommended: "true",
      officialSiteCited: "false",
    }, clock);
    assert.equal(consumer.error, undefined);

    // Manual evidence defaults to consumer_ui in submitManualEvidence — verify command path.
    const apiView = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "model_api" });
    const consumerView = await readEvidenceOverview(db, owner, { brandId: brand, sourceMode: "consumer_ui" });
    assert.equal("error" in apiView, false);
    assert.equal("error" in consumerView, false);
    // All manual submits use consumer_ui per evidence rules.
    assert.equal(apiView.sampleCount, 0);
    assert.ok(consumerView.sampleCount >= 1);
    assert.ok(consumerView.answers.every((item) => item.sourceMode === "consumer_ui"));
  });
}
