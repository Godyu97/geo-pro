import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  cloneContentTemplate,
  exportContentTemplate,
  listContentTemplates,
  updateContentTemplate,
} from "../../src/features/asset-reuse/template-commands.ts";
import {
  cloneContentTemplateSchema,
  updateContentTemplateSchema,
} from "../../src/features/asset-reuse/template-contracts.ts";
import { brandTemplatesQuery, systemTemplatesQuery } from "../../src/features/asset-reuse/template-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T12:00:00.000Z";
const systemName = "事实问答系统模板";
const secretName = "品牌克隆机密名称合成";
const renamedName = "团队草稿新名称";
const blockedName = "改名不应成功";
const rejectedName = "不应写入的新名称";
const brandFields = {
  name: "己品牌",
  description: "Synthetic brand for content templates",
  website: "https://mu.example.com",
  aliases: ["己"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};
const openGates = { fact: true, publicLicense: true, review: true };

test("template messages and clone input stay bilingual and strict", () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  assert.match(zhCN.contentTemplates.GATE_REQUIRED, /门禁/);
  assert.match(zhCN.contentTemplates.fact_gate, /客户案例/);
  assert.match(zhCN.contentTemplates.fact_gate, /交付包/);
  assert.match(zhCN.contentTemplates.SYSTEM_READONLY, /系统模板/);
  assert.match(zhCN.content.templatesLink, /模板/);
  assert.match(en.contentTemplates.GATE_REQUIRED, /gate/i);
  assert.match(en.contentTemplates.fact_gate, /customer case/i);
  assert.match(en.contentTemplates.fact_gate, /delivery package/i);
  assert.match(en.contentTemplates.SYSTEM_READONLY, /system template/i);
  assert.match(en.content.templatesLink, /template/i);
  assert.equal(safeReturnTo("/dashboard/content/templates?brandId=1"), "/dashboard/content/templates?brandId=1");
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const id = randomUUID();
  assert.equal(cloneContentTemplateSchema.safeParse({
    brandId, id, gates: { fact: false, publicLicense: true, review: true }, extra: true,
  }).success, false);
  assert.equal(cloneContentTemplateSchema.safeParse({
    brandId, id, gates: { fact: false, publicLicense: true, review: true },
  }).success, true);
  assert.equal(updateContentTemplateSchema.safeParse({
    brandId, id, name: secretName, status: "published", gates: openGates, note: "x",
  }).success, false);
});

function trace(connection) {
  const queries = [];
  const wrap = (current) => ({
    kind: current.kind,
    query(sql, values) {
      queries.push(sql);
      return current.query(sql, values);
    },
    transaction(work) {
      return current.transaction((tx) => work(wrap(tx)));
    },
    savepoint(work) {
      return current.savepoint((nested) => work(wrap(nested)));
    },
    close() {
      return current.close();
    },
  });
  return { connection: wrap(connection), queries };
}

async function addUser(db, id) {
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "模板夹具", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
}

async function addBrand(db, ownerId, id) {
  const brands = new BrandDao(db);
  await brands.insertBrand(ownerId, id, time);
  await brands.insertVersion(id, 1, brandFields, time);
}

async function insertSystem(db, fields) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    `INSERT INTO content_template (
      id, brand_id, owner_id, is_system, source_template_id,
      fact_gate, public_license_gate, review_gate, status,
      asks_to_invent_case_study, name, created_at, updated_at
    ) VALUES (?, NULL, NULL, 1, NULL, ?, ?, ?, 'published', ?, ?, ?, ?)`,
    [id, fields.fact, fields.license, fields.review, fields.invent, fields.name, time, time],
  );
  return id;
}

async function seedBrief(db, brandId, ownerId) {
  const briefId = randomUUID();
  const versionId = randomUUID();
  await queryWithParameters(
    db,
    "INSERT INTO content_brief (id, brand_id, owner_id, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)",
    [briefId, brandId, ownerId, time, time],
  );
  await queryWithParameters(
    db,
    `INSERT INTO content_brief_version (
      id, brief_id, brand_id, revision, audience, target_gap, applicable_boundary,
      primary_page, conversion_action, template_kind, title_candidates_json, fact_version_ids_json, created_at
    ) VALUES (?, ?, ?, 1, 'a', 'g', 'b', 'p', 'c', 'fact_faq', '["t"]', '[]', ?)`,
    [versionId, briefId, brandId, time],
  );
  return versionId;
}

async function countOf(db, table) {
  const [row] = await queryWithParameters(db, `SELECT count(*) AS n FROM ${table}`, []);
  return Number(row.n);
}

async function snapshot(db, id) {
  const [row] = await queryWithParameters(
    db,
    `SELECT name, is_system AS "system", fact_gate AS "factGate",
      public_license_gate AS "publicLicenseGate", review_gate AS "reviewGate",
      asks_to_invent_case_study AS "asksToInventCaseStudy", status,
      source_template_id AS "sourceTemplateId", brand_id AS "brandId", owner_id AS "ownerId",
      created_at AS "createdAt", updated_at AS "updatedAt"
     FROM content_template WHERE id = ?`,
    [id],
  );
  return {
    name: row.name,
    system: Number(row.system),
    factGate: Number(row.factGate),
    publicLicenseGate: Number(row.publicLicenseGate),
    reviewGate: Number(row.reviewGate),
    asksToInventCaseStudy: Number(row.asksToInventCaseStudy),
    status: row.status,
    sourceTemplateId: row.sourceTemplateId,
    brandId: row.brandId,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function briefKind(db, id) {
  const [row] = await queryWithParameters(
    db,
    'SELECT template_kind AS "templateKind" FROM content_brief_version WHERE id = ?',
    [id],
  );
  return row.templateKind;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: content templates keep gates, hide clone names, and skip delivery packages`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const owner = randomUUID();
      const stranger = randomUUID();
      const brand = randomUUID();
      const strangerBrand = randomUUID();
      await addUser(db, owner);
      await addUser(db, stranger);
      await addBrand(db, owner, brand);
      await addBrand(db, stranger, strangerBrand);
      const systemId = await insertSystem(db, { name: systemName, fact: 1, license: 1, review: 1, invent: 0 });
      const closedId = await insertSystem(db, { name: "事实门禁关闭的系统模板", fact: 0, license: 1, review: 1, invent: 0 });
      const inventId = await insertSystem(db, { name: "禁止编造案例模板", fact: 1, license: 1, review: 1, invent: 1 });
      const briefVersionId = await seedBrief(db, brand, owner);
      const systemBefore = await snapshot(db, systemId);
      const closedBefore = await snapshot(db, closedId);
      const templatesBefore = await countOf(db, "content_template");
      const packagesBefore = await countOf(db, "content_delivery_package");

      const tracedBlock = trace(db);
      const blocked = await cloneContentTemplate(tracedBlock.connection, owner, {
        brandId: brand,
        id: systemId,
        gates: { fact: false, publicLicense: true, review: true },
        name: secretName,
      }, time);
      assert.equal(blocked.error, "GATE_REQUIRED");
      assert.equal(blocked.reason, "gate_required");
      assert.equal(JSON.stringify(blocked).includes(secretName), false);
      assert.equal(tracedBlock.queries.some((sql) => /insert\s+into\s+content_template/i.test(sql)), false);
      assert.equal(await countOf(db, "content_template"), templatesBefore);
      assert.deepEqual(await snapshot(db, systemId), systemBefore);

      const closed = await cloneContentTemplate(db, owner, {
        brandId: brand,
        id: closedId,
        gates: openGates,
      }, time);
      assert.equal(closed.error, "GATE_REQUIRED");
      assert.equal(closed.reason, "gate_required");
      assert.equal(await countOf(db, "content_template"), templatesBefore);
      assert.deepEqual(await snapshot(db, closedId), closedBefore);

      const cloned = await cloneContentTemplate(db, owner, {
        brandId: brand,
        id: systemId,
        gates: openGates,
        name: secretName,
      }, time);
      assert.equal(cloned.readOnlySource, true);
      assert.equal(cloned.template.system, false);
      assert.equal(cloned.template.name, secretName);
      assert.deepEqual(cloned.template.gates, openGates);
      assert.equal(cloned.template.sourceTemplateId, systemId);
      assert.equal(cloned.template.status, "draft");
      assert.equal(cloned.template.asksToInventCaseStudy, false);
      const created = await snapshot(db, cloned.template.id);
      assert.equal(created.system, 0);
      assert.equal(created.factGate, 1);
      assert.equal(created.publicLicenseGate, 1);
      assert.equal(created.reviewGate, 1);
      assert.equal(created.sourceTemplateId, systemId);
      assert.equal(created.brandId, brand);
      assert.equal(created.ownerId, owner);
      assert.deepEqual(await snapshot(db, systemId), systemBefore);
      assert.equal(await briefKind(db, briefVersionId), "fact_faq");
      assert.equal(await countOf(db, "content_delivery_package"), packagesBefore);

      const own = await listContentTemplates(db, owner, brand);
      assert.equal(own.templates.some((item) => item.name === secretName), true);
      const hidden = await listContentTemplates(db, stranger, brand);
      assert.equal(hidden.error, "NOT_FOUND");
      assert.equal(JSON.stringify(hidden).includes(secretName), false);
      const strangerList = await listContentTemplates(db, stranger, strangerBrand);
      assert.equal(strangerList.templates.some((item) => item.name === systemName), true);
      assert.equal(strangerList.templates.some((item) => item.name === secretName), false);
      assert.equal(JSON.stringify(strangerList).includes(secretName), false);
      const hiddenExport = await exportContentTemplate(db, stranger, { brandId: brand, id: cloned.template.id });
      assert.equal(hiddenExport.error, "NOT_FOUND");
      assert.equal(JSON.stringify(hiddenExport).includes(secretName), false);

      const templatesAtExport = await countOf(db, "content_template");
      const checked = await exportContentTemplate(db, owner, { brandId: brand, id: inventId });
      assert.deepEqual(checked, { allowed: false, reason: "fact_gate" });
      const approval = await exportContentTemplate(db, owner, { brandId: brand, id: cloned.template.id });
      assert.deepEqual(approval, { allowed: false, reason: "approval_gate" });
      assert.equal(await countOf(db, "content_delivery_package"), packagesBefore);
      assert.equal(await countOf(db, "content_template"), templatesAtExport);
      assert.equal(await briefKind(db, briefVersionId), "fact_faq");

      const tracedUpdate = trace(db);
      const readonly = await updateContentTemplate(tracedUpdate.connection, owner, {
        brandId: brand,
        id: systemId,
        name: rejectedName,
        status: "retired",
        gates: openGates,
      }, time);
      assert.equal(readonly.error, "SYSTEM_READONLY");
      assert.equal(JSON.stringify(readonly).includes(systemName), false);
      assert.equal(JSON.stringify(readonly).includes(secretName), false);
      assert.equal(tracedUpdate.queries.some((sql) => /update\s+content_template/i.test(sql)), false);
      assert.deepEqual(await snapshot(db, systemId), systemBefore);

      const cloneBefore = await snapshot(db, cloned.template.id);
      const gateUpdate = await updateContentTemplate(db, owner, {
        brandId: brand,
        id: cloned.template.id,
        name: blockedName,
        status: "published",
        gates: { fact: false, publicLicense: true, review: true },
      }, time);
      assert.equal(gateUpdate.error, "GATE_REQUIRED");
      assert.equal(gateUpdate.reason, "gate_required");
      assert.deepEqual(await snapshot(db, cloned.template.id), cloneBefore);

      const renamed = await updateContentTemplate(db, owner, {
        brandId: brand,
        id: cloned.template.id,
        name: renamedName,
        status: "published",
        gates: openGates,
      }, time);
      assert.equal(renamed.template.name, renamedName);
      assert.equal(renamed.template.status, "published");
      assert.deepEqual(renamed.template.gates, openGates);
      assert.equal(renamed.template.sourceTemplateId, systemId);
      const afterRename = await snapshot(db, cloned.template.id);
      assert.equal(afterRename.factGate, 1);
      assert.equal(afterRename.publicLicenseGate, 1);
      assert.equal(afterRename.reviewGate, 1);
      assert.equal(afterRename.sourceTemplateId, systemId);
      assert.deepEqual(await snapshot(db, systemId), systemBefore);
      const afterList = await listContentTemplates(db, stranger, strangerBrand);
      assert.equal(JSON.stringify(afterList).includes(secretName), false);
      assert.equal(JSON.stringify(afterList).includes(renamedName), false);
      assert.equal(await briefKind(db, briefVersionId), "fact_faq");

      for (let index = 0; index < 12; index += 1) {
        await insertSystem(db, { name: `system-${index}`, fact: 1, license: 1, review: 1, invent: 0 });
        await queryWithParameters(
          db,
          `INSERT INTO content_template (
            id, brand_id, owner_id, is_system, source_template_id,
            fact_gate, public_license_gate, review_gate, status,
            asks_to_invent_case_study, name, created_at, updated_at
          ) VALUES (?, ?, ?, 0, ?, 1, 1, 1, 'draft', 0, ?, ?, ?)`,
          [randomUUID(), brand, owner, systemId, `clone-${index}`, time, time],
        );
      }
      if (db.kind === "postgresql") await db.query("ANALYZE content_template");
      const planFor = async (sql, values) => db.kind === "postgresql"
        ? db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return JSON.stringify(await queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${sql}`, values));
        })
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${sql}`, values));
      const systemQuery = systemTemplatesQuery();
      const brandQuery = brandTemplatesQuery(owner, brand);
      const systemPlan = await planFor(systemQuery.sql, systemQuery.values);
      const brandPlan = await planFor(brandQuery.sql, brandQuery.values);
      assert.match(systemPlan, /content_template_system_idx/);
      assert.match(brandPlan, /content_template_owner_idx/);
      if (db.kind === "postgresql") {
        assert.doesNotMatch(systemPlan, /Seq Scan on content_template/);
        assert.doesNotMatch(brandPlan, /Seq Scan on content_template/);
      }
      const defined = JSON.stringify(await structure(db));
      assert.match(defined, /content_template_system_idx/);
      assert.match(defined, /content_template_owner_idx/);
      assert.match(defined, /content_template_state_check/);
      if (db.kind === "postgresql") assert.match(defined, /content_template_source_fk/);
      else assert.match(defined, /FOREIGN KEY \(`source_template_id`\) REFERENCES `content_template`/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
