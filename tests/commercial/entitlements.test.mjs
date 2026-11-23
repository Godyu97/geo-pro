import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  nextEntitlementVersion,
  plainInteger,
  usageStaysOnEntitlement,
  usageTotals,
} from "../../src/features/commercial/entitlement.ts";
import {
  entitlementErrors,
  entitlementHasChargeSuccess,
  entitlementRegistrationInput,
  entitlementRevisionInput,
  entitlementUsageInput,
} from "../../src/features/commercial/entitlement-contracts.ts";
import {
  listServiceEntitlements,
  loadEntitlementWorkspace,
  readServiceEntitlement,
  recordEntitlementUsage,
  registerServiceEntitlement,
  reviseServiceEntitlement,
} from "../../src/features/commercial/entitlement-commands.ts";
import { ownerEntitlementQuery, ownerEntitlementsQuery } from "../../src/features/commercial/entitlement-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T06:00:00.000Z";
const later = "2026-11-23T07:00:00.000Z";
const nameA = "品牌甲权益名称合成";
const nameB = "品牌乙权益名称合成";
const factA = "品牌甲权益事实合成不可泄露";
const secretMonitoring = 81001;
const secretContent = 81002;
const secretLabor = 81003;

test("entitlement versions stay separate from usage and reject charge claims", async () => {
  assert.equal(entitlementErrors.INVALID_INPUT, 400);
  assert.equal(entitlementErrors.NOT_FOUND, 404);
  assert.equal(safeReturnTo("/dashboard/commercial/entitlements"), "/dashboard/commercial/entitlements");
  assert.equal(nextEntitlementVersion(1), 2);
  assert.equal(usageStaysOnEntitlement("old-entitlement", "new-entitlement"), true);
  assert.equal(plainInteger(1000), "1000");
  assert.deepEqual(usageTotals([{ kind: "monitoring", quantity: 2 }, { kind: "monitoring", quantity: 3 }]), {
    monitoring: 5,
    content: 0,
    labor: 0,
  });

  const brandId = randomUUID();
  const trial = { brandId, kind: "trial", monitoringQuota: 10, contentQuota: 20, laborQuota: 30 };
  assert.deepEqual(entitlementRegistrationInput(trial), { input: trial });
  assert.equal(entitlementRegistrationInput({ ...trial, kind: "quote" }).input.kind, "quote");
  assert.equal(entitlementRegistrationInput({ ...trial, paid: 1 }).error, "INVALID_INPUT");
  assert.equal(entitlementRegistrationInput({ ...trial, paymentReceived: true }).error, "INVALID_INPUT");
  assert.equal(entitlementRegistrationInput({ ...trial, collected: true }).error, "INVALID_INPUT");
  assert.equal(entitlementRegistrationInput({ ...trial, kind: "charged" }).error, "INVALID_INPUT");
  assert.equal(entitlementRegistrationInput({ ...trial, status: "paid" }).error, "INVALID_INPUT");
  const revision = { kind: "trial", monitoringQuota: 40, contentQuota: 50, laborQuota: 60 };
  assert.deepEqual(entitlementRevisionInput(revision), { input: revision });
  assert.equal(entitlementRevisionInput({ ...revision, collected: true }).error, "INVALID_INPUT");
  assert.equal(entitlementRevisionInput({ ...revision, brandId }).error, "INVALID_INPUT");
  const usage = { kind: "monitoring", quantity: 4 };
  assert.deepEqual(entitlementUsageInput(usage), { input: usage });
  assert.equal(entitlementUsageInput({ ...usage, paid: true }).error, "INVALID_INPUT");
  assert.equal(entitlementUsageInput({ ...usage, entitlementId: brandId }).error, "INVALID_INPUT");
  assert.equal(entitlementUsageInput({ kind: "monitoring", quantity: 0 }).error, "INVALID_INPUT");

  const zh = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.equal(zh.entitlements.kindTrial, "试用");
  assert.equal(zh.entitlements.kindQuote, "报价");
  assert.equal(zh.entitlements.uncollected, "未收款");
  assert.equal(en.entitlements.kindTrial, "Trial");
  assert.equal(en.entitlements.kindQuote, "Quote");
  assert.equal(en.entitlements.uncollected, "Not collected");
  for (const catalog of [zh.entitlements, en.entitlements]) {
    assert.equal(/收款成功|payment received|paid successfully|payment successful/i.test(JSON.stringify(catalog)), false);
  }
  const panel = await readFile(new URL("../../src/features/commercial/entitlements-panel.tsx", import.meta.url), "utf8");
  assert.equal(panel.includes("toLocaleString"), false);
  assert.equal(panel.includes("NumberFormat"), false);
  assert.equal(panel.includes("plainInteger"), true);
  assert.equal(panel.includes("uncollected"), true);

  const query = ownerEntitlementsQuery(brandId);
  assert.deepEqual(query.values, [brandId, 100]);
  assert.equal(query.sql.includes("service_entitlement"), true);
  assert.equal(query.sql.includes("entitlement_usage"), true);
  assert.equal(query.sql.includes("owner_id = ?"), true);
  assert.equal(query.sql.includes("paid"), false);
  assert.equal(query.sql.includes("UPDATE"), false);
  const one = ownerEntitlementQuery(brandId, brandId);
  assert.equal(one.sql.includes("e.id = ? AND e.owner_id = ?"), true);
  assert.equal(one.sql.includes("entitlement_usage"), true);
});

function hidden(value, forbidden) {
  const text = JSON.stringify(value);
  for (const secret of forbidden) assert.equal(text.includes(String(secret)), false);
  return text;
}

function entitlementColumns(kind, snapshot) {
  if (kind === "postgresql") {
    return snapshot.columns
      .filter((column) => column.table_name === "service_entitlement" || column.table_name === "entitlement_usage")
      .map((column) => `${column.table_name}.${column.column_name}`)
      .sort()
      .join(",");
  }
  return snapshot.filter((row) => row.name === "service_entitlement" || row.name === "entitlement_usage").map((row) => row.sql).join("\n");
}

async function addUser(db, id) {
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [id, "权益夹具", `${id}@example.invalid`]);
}

async function addBrand(db, ownerId, id, name) {
  await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
    VALUES (?, ?, 'active', 1, 1, ?)`, [id, ownerId, time]);
  await queryWithParameters(db, `INSERT INTO brand_version (brand_id, version, name, content, created_at)
    VALUES (?, 1, ?, ?, ?)`, [id, name, JSON.stringify({ fact: factA, name }), time]);
}

async function countOf(db, table) {
  const [row] = await queryWithParameters(db, `SELECT count(*) AS n FROM ${table}`, []);
  return Number(row.n);
}

function watch(db) {
  const sqls = [];
  return {
    sqls,
    connection: {
      kind: db.kind,
      query(sql, values) {
        sqls.push(sql);
        return db.query(sql, values);
      },
    },
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: a package revision keeps usage on the previous entitlement`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const columns = entitlementColumns(db.kind, await structure(db));
      assert.match(columns, /version/);
      assert.match(columns, /monitoring_quota/);
      assert.match(columns, /content_quota/);
      assert.match(columns, /labor_quota/);
      assert.match(columns, /quantity/);
      assert.equal(columns.includes("paid"), false);
      assert.equal(columns.includes("payment"), false);
      assert.equal(columns.includes("collected"), false);

      const ownerA = randomUUID();
      const ownerB = randomUUID();
      const brandA = randomUUID();
      const brandB = randomUUID();
      const frozen = randomUUID();
      await addUser(db, ownerA);
      await addUser(db, ownerB);
      await addBrand(db, ownerA, frozen, "冻结品牌权益名称合成");
      await queryWithParameters(db, `UPDATE brand SET frozen_at = ? WHERE id = ?`, [time, frozen]);
      await addBrand(db, ownerA, brandA, nameA);
      await addBrand(db, ownerB, brandB, nameB);

      assert.equal(entitlementRegistrationInput({
        brandId: brandA, kind: "trial", monitoringQuota: 10, contentQuota: 20, laborQuota: 30, paid: true,
      }).error, "INVALID_INPUT");
      assert.equal(await countOf(db, "service_entitlement"), 0);

      const createdWatch = watch(db);
      const trial = await registerServiceEntitlement(createdWatch.connection, ownerA, {
        brandId: brandA, kind: "trial", monitoringQuota: 10, contentQuota: 20, laborQuota: 30,
      }, time);
      assert.equal(createdWatch.sqls.length, 1);
      assert.match(createdWatch.sqls[0], /INSERT INTO service_entitlement/);
      assert.equal(createdWatch.sqls[0].includes("UPDATE"), false);
      assert.equal(trial.entitlement.kind, "trial");
      assert.equal(trial.entitlement.version, 1);
      assert.equal(trial.entitlement.monitoringQuota, 10);
      assert.equal(entitlementHasChargeSuccess(trial), false);
      assert.equal(/paid|collected|paymentReceived/.test(JSON.stringify(trial)), false);

      const quote = await registerServiceEntitlement(db, ownerA, {
        brandId: brandA, kind: "quote", monitoringQuota: 11, contentQuota: 21, laborQuota: 31,
      }, time);
      assert.equal(quote.entitlement.kind, "quote");
      assert.equal(quote.entitlement.version, 1);
      assert.notEqual(quote.entitlement.id, trial.entitlement.id);

      const usageWatch = watch(db);
      const usage = await recordEntitlementUsage(usageWatch.connection, ownerA, trial.entitlement.id, {
        kind: "monitoring", quantity: 4,
      }, time);
      assert.equal(usageWatch.sqls.length, 1);
      assert.match(usageWatch.sqls[0], /INSERT INTO entitlement_usage/);
      assert.equal(usageWatch.sqls[0].includes("UPDATE"), false);
      assert.equal(usage.usage.entitlementId, trial.entitlement.id);
      assert.equal(usage.usage.quantity, 4);

      const revisedWatch = watch(db);
      const revised = await reviseServiceEntitlement(revisedWatch.connection, ownerA, trial.entitlement.id, {
        kind: "trial", monitoringQuota: 40, contentQuota: 50, laborQuota: 60,
      }, later);
      assert.equal(revisedWatch.sqls.length, 1);
      assert.match(revisedWatch.sqls[0], /INSERT INTO service_entitlement/);
      assert.equal(revisedWatch.sqls[0].includes("UPDATE"), false);
      assert.equal(revisedWatch.sqls[0].includes("entitlement_usage"), false);
      assert.equal(revised.entitlement.version, 2);
      assert.equal(revised.entitlement.monitoringQuota, 40);
      assert.notEqual(revised.entitlement.id, trial.entitlement.id);
      assert.equal(entitlementHasChargeSuccess(revised), false);
      const [storedUsage] = await queryWithParameters(
        db,
        `SELECT entitlement_id AS "entitlementId", quantity FROM entitlement_usage WHERE id = ?`,
        [usage.usage.id],
      );
      assert.equal(storedUsage.entitlementId, trial.entitlement.id);
      assert.equal(usageStaysOnEntitlement(storedUsage.entitlementId, revised.entitlement.id), true);

      const listedWatch = watch(db);
      const own = await listServiceEntitlements(listedWatch.connection, ownerA);
      assert.equal(listedWatch.sqls.length, 1);
      assert.equal(listedWatch.sqls[0].includes("service_entitlement"), true);
      assert.equal(listedWatch.sqls[0].includes("entitlement_usage"), true);
      const previous = own.entitlements.find((entitlement) => entitlement.id === trial.entitlement.id);
      const next = own.entitlements.find((entitlement) => entitlement.id === revised.entitlement.id);
      assert.equal(previous.usageTotals.monitoring, 4);
      assert.equal(previous.usages[0].id, usage.usage.id);
      assert.equal(next.usageTotals.monitoring, 0);
      assert.equal(next.usages.length, 0);
      assert.equal(plainInteger(previous.monitoringQuota), "10");
      assert.equal(plainInteger(next.monitoringQuota), "40");
      hidden(own, [secretMonitoring, secretContent, secretLabor, nameB, factA]);

      const foreignBrand = await registerServiceEntitlement(db, ownerA, {
        brandId: brandB, kind: "trial", monitoringQuota: 1, contentQuota: 1, laborQuota: 1,
      }, time);
      assert.equal(foreignBrand.error, "NOT_FOUND");
      const frozenBrand = await registerServiceEntitlement(db, ownerA, {
        brandId: frozen, kind: "trial", monitoringQuota: 1, contentQuota: 1, laborQuota: 1,
      }, time);
      assert.equal(frozenBrand.error, "NOT_FOUND");
      const secret = await registerServiceEntitlement(db, ownerB, {
        brandId: brandB, kind: "trial", monitoringQuota: secretMonitoring, contentQuota: secretContent, laborQuota: secretLabor,
      }, time);
      const missed = await readServiceEntitlement(db, ownerA, secret.entitlement.id);
      assert.deepEqual(missed, { error: "NOT_FOUND" });
      hidden(missed, [secretMonitoring, secretContent, secretLabor, nameB, factA]);
      const foreignRevise = await reviseServiceEntitlement(db, ownerA, secret.entitlement.id, {
        kind: "quote", monitoringQuota: 1, contentQuota: 1, laborQuota: 1,
      }, later);
      assert.deepEqual(foreignRevise, { error: "NOT_FOUND" });
      hidden(foreignRevise, [secretMonitoring, secretContent, secretLabor]);
      const foreignUsage = await recordEntitlementUsage(db, ownerA, secret.entitlement.id, { kind: "content", quantity: 2 }, later);
      assert.deepEqual(foreignUsage, { error: "NOT_FOUND" });
      hidden(foreignUsage, [secretMonitoring, secretContent, secretLabor]);
      const [secretStill] = await queryWithParameters(
        db,
        `SELECT version, monitoring_quota AS "monitoringQuota" FROM service_entitlement WHERE id = ?`,
        [secret.entitlement.id],
      );
      assert.equal(secretStill.version, 1);
      assert.equal(secretStill.monitoringQuota, secretMonitoring);

      const workspaceWatch = watch(db);
      const workspace = await loadEntitlementWorkspace(workspaceWatch.connection, ownerA);
      assert.equal(workspaceWatch.sqls.length, 2);
      assert.equal(workspaceWatch.sqls.filter((sql) => sql.includes("service_entitlement")).length, 1);
      assert.equal(workspace.brands[0].name, nameA);
      hidden(workspace, [factA, nameB, secretMonitoring]);

      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO service_entitlement
          (id, brand_id, owner_id, version, kind, monitoring_quota, content_quota, labor_quota, created_at)
          VALUES (?, ?, ?, 1, 'paid', 1, 1, 1, ?)`, [randomUUID(), brandA, ownerA, time]),
        /CHECK|check|constraint/i,
      );
      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO entitlement_usage
          (id, entitlement_id, kind, quantity, created_at)
          VALUES (?, ?, 'paid', 1, ?)`, [randomUUID(), trial.entitlement.id, time]),
        /CHECK|check|constraint/i,
      );
      await assert.rejects(
        () => queryWithParameters(db, `INSERT INTO service_entitlement
          (id, brand_id, owner_id, version, kind, monitoring_quota, content_quota, labor_quota, created_at)
          VALUES (?, ?, ?, 1, 'trial', -1, 1, 1, ?)`, [randomUUID(), brandA, ownerA, time]),
        /CHECK|check|constraint/i,
      );

      for (let index = 0; index < 24; index += 1) {
        await queryWithParameters(db, `INSERT INTO service_entitlement
          (id, brand_id, owner_id, version, kind, monitoring_quota, content_quota, labor_quota, created_at)
          VALUES (?, ?, ?, ?, 'quote', 1, 1, 1, ?)`, [randomUUID(), brandA, ownerA, index + 2, time]);
      }
      const scale = watch(db);
      const scaled = await listServiceEntitlements(scale.connection, ownerA);
      assert.equal(scale.sqls.length, 1);
      assert.equal(scaled.entitlements.length, 27);
      hidden(scaled, [secretMonitoring, secretContent, secretLabor, nameB]);
      if (db.kind === "postgresql") await db.query("ANALYZE service_entitlement");
      if (db.kind === "postgresql") await db.query("ANALYZE entitlement_usage");
      const listQuery = ownerEntitlementsQuery(ownerA);
      const planFor = async (sql, values) => db.kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
      const plan = await planFor(listQuery.sql, listQuery.values);
      assert.match(plan, /service_entitlement_owner_idx/);
      assert.match(JSON.stringify(await structure(db)), /service_entitlement_owner_idx/);
      assert.match(JSON.stringify(await structure(db)), /entitlement_usage_entitlement_idx/);
      assert.match(JSON.stringify(await structure(db)), /service_entitlement_brand_kind_version_uidx/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
