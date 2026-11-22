import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  freezeLeadValidityRule,
  listLeadQuality,
  qualifyLeadAgainstRule,
  recordLeadObservation,
  saveLeadValidityRule,
} from "../../src/features/business-feedback/quality-commands.ts";
import {
  leadQualityErrors,
  recordLeadObservationSchema,
  saveLeadRuleSchema,
} from "../../src/features/business-feedback/quality-contracts.ts";
import {
  leadObservationListQuery,
  leadQualificationListQuery,
  leadQualifiedCountQuery,
  leadValidityRuleListQuery,
} from "../../src/features/business-feedback/quality-dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const stamps = [
  "2026-11-22T08:00:00.000Z",
  "2026-11-22T08:01:00.000Z",
  "2026-11-22T08:02:00.000Z",
  "2026-11-22T08:03:00.000Z",
  "2026-11-22T08:04:00.000Z",
  "2026-11-22T08:05:00.000Z",
  "2026-11-22T08:06:00.000Z",
];

test("lead quality input rejects extra fields and a negative denominator", () => {
  assert.equal(leadQualityErrors.NOT_FOUND, 404);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  assert.equal(saveLeadRuleSchema.safeParse({
    brandId,
    requiresRealNeed: true,
    requiresIndustry: true,
    requiresFollowUp: true,
    phone: "13800138000",
  }).success, false);
  assert.equal(recordLeadObservationSchema.safeParse({
    brandId,
    identifiedReferrals: 17,
    sessionDenominator: null,
    selfReported: 5,
    crawlerVisits: 4,
    answerCitations: 0,
    siteVisits: 100,
  }).success, false);
  assert.equal(recordLeadObservationSchema.safeParse({
    brandId,
    identifiedReferrals: 17,
    sessionDenominator: -1,
    selfReported: 5,
    crawlerVisits: 4,
    answerCitations: 0,
  }).success, false);
  assert.equal(recordLeadObservationSchema.safeParse({
    brandId,
    identifiedReferrals: 17,
    sessionDenominator: null,
    selfReported: 5,
    crawlerVisits: 4,
    answerCitations: 0,
  }).success, true);
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

function clockFrom(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function fromTable(sql, table) {
  return new RegExp(`\\bFROM ${table}\\b`).test(sql);
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Quality owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: frozen validity keeps its version and an empty denominator stays null`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        assert.deepEqual(await structure(db), await structure(ddl.connection));
        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, stamps[0]);
        await brands.insertBrand(outsider, otherBrand, stamps[0]);
        const clock = clockFrom(stamps);
        const switches = { requiresRealNeed: true, requiresIndustry: true, requiresFollowUp: true };

        const hidden = await saveLeadValidityRule(db, outsider, { brandId: brand, ...switches }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes("requiresRealNeed"), false);

        const created = await saveLeadValidityRule(db, owner, { brandId: brand, ...switches }, clock);
        assert.equal(created.rule.version, 1);
        assert.equal(created.rule.frozen, false);
        const unfrozen = await qualifyLeadAgainstRule(db, owner, {
          brandId: brand,
          ruleId: created.rule.id,
          realNeed: true,
          targetIndustry: true,
          followUp: true,
        }, clock);
        assert.equal(unfrozen.qualification.status, "unfrozen");
        assert.equal(unfrozen.qualification.ruleVersion, 1);
        const beforeFreeze = await listLeadQuality(db, owner, brand);
        assert.equal(beforeFreeze.qualifiedCount, 0);

        const frozen = await freezeLeadValidityRule(db, owner, created.rule.id);
        assert.equal(frozen.rule.version, 1);
        assert.equal(frozen.rule.frozen, true);
        const deniedFreeze = await freezeLeadValidityRule(db, outsider, created.rule.id);
        assert.deepEqual(deniedFreeze, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(deniedFreeze).includes("requiresIndustry"), false);

        const disqualified = await qualifyLeadAgainstRule(db, owner, {
          brandId: brand,
          ruleId: created.rule.id,
          realNeed: true,
          targetIndustry: false,
          followUp: true,
        }, clock);
        assert.equal(disqualified.qualification.status, "disqualified");
        assert.equal(disqualified.qualification.ruleVersion, 1);
        const qualified = await qualifyLeadAgainstRule(db, owner, {
          brandId: brand,
          ruleId: created.rule.id,
          realNeed: true,
          targetIndustry: true,
          followUp: true,
        }, clock);
        assert.equal(qualified.qualification.status, "qualified");
        assert.equal(qualified.qualification.ruleVersion, 1);

        const revised = await saveLeadValidityRule(db, owner, {
          brandId: brand,
          requiresRealNeed: true,
          requiresIndustry: false,
          requiresFollowUp: true,
        }, clock);
        assert.equal(revised.rule.version, 2);
        assert.equal(revised.rule.frozen, false);
        assert.equal(revised.rule.requiresIndustry, false);
        assert.notEqual(revised.rule.id, created.rule.id);

        const missing = await recordLeadObservation(db, owner, {
          brandId: brand,
          identifiedReferrals: 17,
          sessionDenominator: null,
          selfReported: 5,
          crawlerVisits: 4,
          answerCitations: 0,
        }, clock);
        assert.equal(missing.observation.identified.count, 17);
        assert.equal(missing.observation.identified.rate, null);
        assert.equal(missing.observation.selfReported, 5);
        assert.equal(missing.observation.selfReportedOverVisits, null);
        assert.equal(missing.observation.crawlerVisits, 4);
        assert.equal(missing.observation.answerCitations, 0);
        assert.equal(missing.observation.calledIncluded, false);
        const zero = await recordLeadObservation(db, owner, {
          brandId: brand,
          identifiedReferrals: 3,
          sessionDenominator: 0,
          selfReported: 1,
          crawlerVisits: 1,
          answerCitations: 2,
        }, clock);
        assert.equal(zero.observation.identified.count, 3);
        assert.equal(zero.observation.identified.rate, null);
        assert.equal(zero.observation.calledIncluded, false);

        const quality = await listLeadQuality(db, owner, brand);
        assert.equal(quality.qualifiedCount, 1);
        assert.deepEqual(quality.rules.map((rule) => [rule.version, rule.frozen, rule.requiresIndustry]), [
          [1, true, true],
          [2, false, false],
        ]);
        assert.deepEqual(quality.qualifications.map((item) => [item.ruleId, item.ruleVersion, item.status]), [
          [created.rule.id, 1, "unfrozen"],
          [created.rule.id, 1, "disqualified"],
          [created.rule.id, 1, "qualified"],
        ]);
        assert.equal(quality.observations[0].identified.count, 17);
        assert.equal(quality.observations[0].identified.rate, null);
        assert.equal(quality.observations[0].crawlerVisits, 4);
        assert.equal(quality.observations[0].answerCitations, 0);
        assert.equal(quality.observations[0].calledIncluded, false);
        assert.equal(quality.observations[1].sessionDenominator, 0);
        assert.equal(quality.observations[1].identified.rate, null);

        const storedRules = await queryWithParameters(
          db,
          `SELECT version, frozen, requires_industry AS "requiresIndustry" FROM lead_validity_rule
           WHERE brand_id = ? ORDER BY version`,
          [brand],
        );
        assert.equal(storedRules.length, 2);
        assert.equal(Number(storedRules[0].version), 1);
        assert.equal(Number(storedRules[0].frozen), 1);
        assert.equal(Number(storedRules[0].requiresIndustry), 1);
        const storedJudgments = await queryWithParameters(
          db,
          `SELECT rule_version AS "ruleVersion" FROM lead_qualification WHERE brand_id = ? ORDER BY created_at, id`,
          [brand],
        );
        assert.deepEqual(storedJudgments.map((row) => Number(row.ruleVersion)), [1, 1, 1]);
        const storedObservations = await queryWithParameters(
          db,
          `SELECT identified_referrals AS "identifiedReferrals", session_denominator AS "sessionDenominator",
             crawler_visits AS "crawlerVisits", answer_citations AS "answerCitations",
             called_included AS "calledIncluded"
           FROM lead_observation WHERE brand_id = ? ORDER BY created_at, id`,
          [brand],
        );
        assert.equal(Number(storedObservations[0].identifiedReferrals), 17);
        assert.equal(storedObservations[0].sessionDenominator, null);
        assert.equal(Number(storedObservations[0].crawlerVisits), 4);
        assert.equal(Number(storedObservations[0].answerCitations), 0);
        assert.equal(Number(storedObservations[0].calledIncluded), 0);

        const leaked = await listLeadQuality(db, outsider, brand);
        assert.deepEqual(leaked, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(leaked).includes("17"), false);
        assert.equal(JSON.stringify(leaked).includes("requiresRealNeed"), false);
        const outsiderOwn = await listLeadQuality(db, outsider, otherBrand);
        assert.equal(outsiderOwn.qualifiedCount, 0);
        assert.equal(outsiderOwn.observations.length, 0);
        assert.equal(JSON.stringify(outsiderOwn).includes("17"), false);

        const small = watch(db);
        const smallList = await listLeadQuality(small.connection, owner, brand);
        assert.equal(smallList.observations.length, 2);
        assert.equal(small.captured.filter((item) => fromTable(item.sql, "lead_observation")).length, 1);
        assert.equal(small.captured.filter((item) => fromTable(item.sql, "lead_validity_rule")).length, 1);
        assert.equal(small.captured.filter((item) => fromTable(item.sql, "lead_qualification")).length, 2);

        const extra = [];
        const extraValues = [];
        for (let index = 0; index < 40; index += 1) {
          extra.push("(?, ?, ?, 1, null, 0, 0, 0, 0, ?)");
          extraValues.push(randomUUID(), brand, owner, stamps[0]);
        }
        await queryWithParameters(
          db,
          `INSERT INTO lead_observation (
            id, brand_id, owner_id, identified_referrals, session_denominator, self_reported,
            crawler_visits, answer_citations, called_included, created_at
          ) VALUES ${extra.join(", ")}`,
          extraValues,
        );
        if (db.kind === "postgresql") {
          await db.query("ANALYZE lead_validity_rule");
          await db.query("ANALYZE lead_qualification");
          await db.query("ANALYZE lead_observation");
        }
        const explained = async (sql, values) => {
          if (db.kind !== "postgresql") {
            return JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
          }
          return db.transaction(async (tx) => {
            await tx.query("SET LOCAL enable_seqscan = off");
            return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
          });
        };
        const ruleQuery = leadValidityRuleListQuery(owner, brand);
        const qualificationQuery = leadQualificationListQuery(owner, brand);
        const countQuery = leadQualifiedCountQuery(owner, brand);
        const observationQuery = leadObservationListQuery(owner, brand);
        assert.match(await explained(ruleQuery.sql, ruleQuery.values), /lead_validity_rule_owner_idx/);
        assert.match(await explained(qualificationQuery.sql, qualificationQuery.values), /lead_qualification_owner_idx/);
        assert.match(await explained(countQuery.sql, countQuery.values), /lead_qualification_(status_idx|owner_idx)/);
        const observationPlan = await explained(observationQuery.sql, observationQuery.values);
        assert.match(observationPlan, /lead_observation_owner_idx/);
        if (db.kind === "postgresql") assert.doesNotMatch(observationPlan, /Seq Scan on lead_observation/);

        const scaled = watch(db);
        const scaledList = await listLeadQuality(scaled.connection, owner, brand);
        assert.equal(scaledList.observations.length, 42);
        assert.equal(scaled.captured.filter((item) => fromTable(item.sql, "lead_observation")).length, 1);
        assert.equal(
          scaled.captured.filter((item) => fromTable(item.sql, "lead_validity_rule")).length,
          small.captured.filter((item) => fromTable(item.sql, "lead_validity_rule")).length,
        );

        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO lead_validity_rule (
              id, brand_id, owner_id, version, frozen, requires_real_need, requires_industry, requires_follow_up, created_at
            ) VALUES (?, ?, ?, 1, 0, 1, 1, 1, ?)`,
            [randomUUID(), brand, owner, stamps[0]],
          ),
          /UNIQUE|unique/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO lead_observation (
              id, brand_id, owner_id, identified_referrals, session_denominator, self_reported,
              crawler_visits, answer_citations, called_included, created_at
            ) VALUES (?, ?, ?, 4, null, 0, 4, 0, 1, ?)`,
            [randomUUID(), brand, owner, stamps[0]],
          ),
          /CHECK|check constraint/i,
        );
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
