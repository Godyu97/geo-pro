import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { importBusinessLeads, listBusinessLeads, readBusinessLead } from "../../src/features/business-feedback/commands.ts";
import { importBusinessLeadsSchema, parseLeadLines, prepareLeadRow, previewLeadCsv } from "../../src/features/business-feedback/contracts.ts";
import { businessLeadErrors } from "../../src/features/business-feedback/contracts.ts";
import { businessLeadEvidenceQuery, businessLeadListQuery } from "../../src/features/business-feedback/dao.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T08:00:00.000Z";
const later = "2026-11-22T09:00:00.000Z";
const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";

test("lead import rejects identity fields and keeps per-row reasons", () => {
  assert.equal(businessLeadErrors.NOT_FOUND, 404);
  assert.equal(importBusinessLeadsSchema.safeParse({
    brandId,
    rows: [{ eventId: "evt-1", evidence: "referral", directIdentifier: false, email: "person@example.com" }],
  }).success, false);
  assert.equal(importBusinessLeadsSchema.safeParse({
    brandId,
    rows: [{ eventId: "evt-1", evidence: "referral", directIdentifier: false, phone: "13800138000" }],
  }).success, false);
  assert.equal(prepareLeadRow({ eventId: "person@example.com", evidence: "unknown", directIdentifier: false }).directIdentifier, true);
  assert.equal(prepareLeadRow({ eventId: "13800138000", evidence: "unknown", directIdentifier: false }).directIdentifier, true);
  const parsed = parseLeadLines("evt-1,self_report,false\nevt-1,referral,false\n,landing_page,false\nevt-2,unknown,true");
  assert.equal(parsed.rows.length, 4);
  assert.equal(parsed.rows[2].eventId, null);
  assert.equal(parseLeadLines("evt-1,referral").error, "INVALID_INPUT");
  assert.equal(previewLeadCsv("evt-1,referral").error, "INVALID_INPUT");
  assert.equal(previewLeadCsv("event_id,evidence\n\"evt-1").error, "INVALID_INPUT");

  const csv = [
    "event_id,evidence,direct_identifier,note",
    "evt-1,self_report,false,\"hello, world\"",
    "\"evt-1\",referral,false,",
    "",
    "13800138000,unknown,false,person@example.com",
    ",landing_page,false,",
    "evt-2,not_a_source,false,",
  ].join("\n");
  const preview = previewLeadCsv(csv);
  assert.equal(preview.totalRows, 5);
  assert.equal(preview.mergedCount, 1);
  assert.deepEqual(preview.upgrades, [{ eventId: "evt-1", from: "self_report", to: "referral" }]);
  assert.deepEqual(preview.rejected, [
    { index: 2, reason: "direct_pii" },
    { index: 3, reason: "missing_id" },
    { index: 4, reason: "invalid_row" },
  ]);
  assert.equal(JSON.stringify(preview.rows).includes("13800138000"), false);
  assert.equal(JSON.stringify(preview.rows).includes("person@example.com"), false);
  assert.equal(JSON.stringify(preview).includes("hello, world"), false);
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

function clockFrom(stamps) {
  let index = 0;
  return () => stamps[Math.min(index++, stamps.length - 1)];
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Lead owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function fromTable(sql, table) {
  return new RegExp(`\\bFROM ${table}\\b`).test(sql);
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: one event keeps both evidence rows and drops direct identifiers`, async () => {
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
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom([time, later]);

        const hidden = await importBusinessLeads(db, outsider, {
          brandId: brand,
          rows: [{ eventId: "evt-hidden", evidence: "referral", directIdentifier: false }],
        }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hidden).includes("evt-hidden"), false);

        const batch = [
          { eventId: "evt-1", evidence: "self_report", directIdentifier: false },
          { eventId: "evt-1", evidence: "referral", directIdentifier: false },
          { eventId: "evt-pii", evidence: "unknown", directIdentifier: true },
          { eventId: null, evidence: "landing_page", directIdentifier: false },
          { eventId: "person@example.com", evidence: "landing_page", directIdentifier: false },
          { eventId: "   ", evidence: "unknown", directIdentifier: false },
        ];
        const watched = watch(db);
        const imported = await importBusinessLeads(watched.connection, owner, { brandId: brand, rows: batch }, clock);
        assert.equal(imported.leads.length, 1);
        assert.equal(imported.leads[0].count, 1);
        assert.equal(imported.leads[0].eventId, "evt-1");
        assert.equal(imported.leads[0].primary, "referral");
        assert.deepEqual(imported.leads[0].evidence, ["self_report", "referral"]);
        assert.deepEqual(imported.rejected, [
          { index: 2, reason: "direct_pii" },
          { index: 3, reason: "missing_id" },
          { index: 4, reason: "direct_pii" },
          { index: 5, reason: "missing_id" },
        ]);
        assert.equal(watched.captured.filter((item) => item.sql.includes("INSERT INTO business_lead ")).length, 1);
        assert.equal(watched.captured.filter((item) => item.sql.includes("INSERT INTO business_lead_evidence")).length, 1);
        const leadReads = watched.captured.filter((item) => fromTable(item.sql, "business_lead")).length;
        assert.equal(leadReads, 2);
        assert.ok(leadReads < batch.length);
        const stored = await queryWithParameters(
          db,
          `SELECT event_id AS "eventId", primary_class AS "primary" FROM business_lead WHERE brand_id = ?`,
          [brand],
        );
        assert.equal(stored.length, 1);
        assert.equal(stored[0].eventId, "evt-1");
        assert.equal(stored[0].primary, "referral");
        const evidence = await queryWithParameters(
          db,
          `SELECT category, position FROM business_lead_evidence WHERE lead_id = ? ORDER BY position`,
          [imported.leads[0].id],
        );
        assert.equal(evidence.length, 2);
        assert.equal(evidence[0].category, "self_report");
        assert.equal(Number(evidence[0].position), 1);
        assert.equal(evidence[1].category, "referral");
        assert.equal(Number(evidence[1].position), 2);

        const again = await importBusinessLeads(db, owner, {
          brandId: brand,
          rows: [{ eventId: "evt-1", evidence: "landing_page", directIdentifier: false }],
        }, clock);
        assert.equal(again.leads.length, 1);
        assert.equal(again.leads[0].id, imported.leads[0].id);
        assert.equal(again.leads[0].count, 1);
        assert.equal(again.leads[0].primary, "referral");
        assert.deepEqual(again.leads[0].evidence, ["self_report", "referral", "landing_page"]);
        const leadCount = await queryWithParameters(db, `SELECT count(*) AS count FROM business_lead WHERE brand_id = ?`, [brand]);
        assert.equal(Number(leadCount[0].count), 1);

        const seeded = await importBusinessLeads(db, owner, {
          brandId: brand,
          rows: [{ eventId: "evt-up", evidence: "self_report", directIdentifier: false }],
        }, clock);
        const raised = await importBusinessLeads(db, owner, {
          brandId: brand,
          rows: [{ eventId: "evt-up", evidence: "referral", directIdentifier: false }],
        }, clock);
        assert.equal(raised.leads.length, 1);
        assert.equal(raised.leads[0].id, seeded.leads[0].id);
        assert.equal(raised.leads[0].primary, "referral");
        assert.deepEqual(raised.leads[0].evidence, ["self_report", "referral"]);
        assert.equal(Number((await queryWithParameters(db, `SELECT count(*) AS count FROM business_lead WHERE event_id = 'evt-up'`, []))[0].count), 1);

        const denied = await readBusinessLead(db, outsider, imported.leads[0].id);
        assert.deepEqual(denied, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(denied).includes("evt-1"), false);
        const outsiderBrand = await listBusinessLeads(db, outsider, brand);
        assert.deepEqual(outsiderBrand, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(outsiderBrand).includes("evt-1"), false);
        const outsiderOwn = await listBusinessLeads(db, outsider, otherBrand);
        assert.deepEqual(outsiderOwn, { leads: [] });

        const small = watch(db);
        const smallList = await listBusinessLeads(small.connection, owner, brand);
        assert.equal(smallList.leads.length, 2);
        assert.equal(small.captured.filter((item) => fromTable(item.sql, "business_lead")).length, 1);
        assert.equal(small.captured.filter((item) => fromTable(item.sql, "business_lead_evidence")).length, 1);

        const extra = Array.from({ length: 40 }, (_, index) => ({
          eventId: `evt-extra-${index}`,
          evidence: "unknown",
          directIdentifier: false,
        }));
        await importBusinessLeads(db, owner, { brandId: brand, rows: extra }, clock);
        if (db.kind === "postgresql") {
          await db.query("ANALYZE business_lead");
          await db.query("ANALYZE business_lead_evidence");
        }
        const listQuery = businessLeadListQuery(owner, brand);
        const evidenceQuery = businessLeadEvidenceQuery(owner, [imported.leads[0].id]);
        const explained = async (sql, values) => {
          if (db.kind !== "postgresql") {
            return JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
          }
          return db.transaction(async (tx) => {
            await tx.query("SET LOCAL enable_seqscan = off");
            return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
          });
        };
        const listPlan = await explained(listQuery.sql, listQuery.values);
        const evidencePlan = await explained(evidenceQuery.sql, evidenceQuery.values);
        assert.match(listPlan, /business_lead_owner_idx/);
        assert.match(evidencePlan, /business_lead_evidence_(lead_idx|category_uidx)/);
        if (db.kind === "postgresql") assert.doesNotMatch(evidencePlan, /Seq Scan on business_lead_evidence/);
        const scaled = watch(db);
        const scaledList = await listBusinessLeads(scaled.connection, owner, brand);
        assert.equal(scaledList.leads.length, 42);
        assert.equal(scaled.captured.filter((item) => fromTable(item.sql, "business_lead")).length, 1);
        assert.equal(scaled.captured.filter((item) => fromTable(item.sql, "business_lead_evidence")).length, 1);
        assert.equal(scaled.captured.filter((item) => fromTable(item.sql, "business_lead")).length, small.captured.filter((item) => fromTable(item.sql, "business_lead")).length);

        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO business_lead (id, brand_id, owner_id, event_id, primary_class, created_at)
             VALUES (?, ?, ?, 'evt-1', 'referral', ?)`,
            [randomUUID(), brand, owner, time],
          ),
          /UNIQUE|unique/i,
        );
        await assert.rejects(
          () => queryWithParameters(
            db,
            `INSERT INTO business_lead (id, brand_id, owner_id, event_id, primary_class, created_at)
             VALUES (?, ?, ?, 'evt-bad', 'email', ?)`,
            [randomUUID(), brand, owner, time],
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
