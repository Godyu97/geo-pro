import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openConnection, queryWithParameters } from "../../src/lib/db/connection.ts";
import { parseDatabaseConfig } from "../../src/lib/db/config.ts";
import { executeBrandCommand } from "../../src/features/brands/commands.ts";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import { executeFactCommand, readFactWorkspace, withEligibleFacts } from "../../src/features/brand-facts/service.ts";
import { emptyFields, previewPaste, reviewDue } from "../../src/features/brand-facts/rules.ts";
import { migrateThrough, structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-18T08:00:00.000Z";
const clock = (iso = time) => () => new Date(iso);
const paste = "  合成规格 🚀\r\n\n  Internal source fixture";
const secret = "Internal attachment description";
const usable = {
  ...emptyFields, category: "price", title: "Synthetic plan price", claim: "Synthetic 100 CNY",
  sourceType: "internal", sourceReference: secret, sourceLocator: "Section 1",
  sourceExcerpt: "Private evidence fixture", sourceDate: "2026-11-18", permission: "public",
  validity: "dated", validThrough: "2026-12-31",
};

async function addBrand(db) {
  const ownerId = randomUUID();
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [ownerId, "Fact owner fixture", `${ownerId}@example.invalid`]);
  const result = await executeBrandCommand(db, ownerId, {
    action: "submit", target: null, expectedDraft: null, actorId: ownerId, operationId: randomUUID(),
    fields: { ...initialBrandFields, name: "Synthetic facts brand", description: "Synthetic data for local acceptance" },
  }, undefined, clock());
  assert.ok(result.mutation);
  return { ownerId, brandId: result.mutation.id };
}

test("offline preview preserves raw UTF-16 offsets, with manual splitting beyond the preview limit", () => {
  const result = previewPaste(paste);
  assert.deepEqual(result.segments.map(({ start, end }) => paste.slice(start, end)), ["合成规格 🚀", "Internal source fixture"]);
  assert.equal(previewPaste("a\n".repeat(31)).more, true);
  assert.deepEqual(previewPaste("\r\n").segments, []);
});

async function checkBatch(db, scope, selectedId) {
  const captured = [];
  const observed = { kind: db.kind, query(sql, values) { captured.push({ sql, values }); return db.query(sql, values); } };
  const read = async () => {
    captured.length = 0;
    const started = performance.now();
    const workspace = await readFactWorkspace(observed, scope, { fact: selectedId }, clock());
    assert.equal(captured.length, 7);
    console.log(`${db.kind} ${workspace.versions.items.length} listed facts, 7 SQL, ${(performance.now() - started).toFixed(2)} ms`);
    return workspace;
  };
  await read();
  const rows = Array.from({ length: 500 }, () => randomUUID());
  await queryWithParameters(db, `INSERT INTO brand_fact_version
    (brand_id, id, fact_id, version, entity_version, revision, state, content, created_at)
    VALUES ${rows.map(() => "(?, ?, ?, 1, 1, 1, 'draft', ?, ?)").join(",")}`,
  rows.flatMap((id) => [scope.brandId, id, id, JSON.stringify(emptyFields), time]));
  if (db.kind === "postgresql") await db.query("ANALYZE brand_fact_version");
  const first = await read();
  assert.equal(first.versions.items.length, 20);
  const listQuery = captured.find(({ sql }) => sql.includes("f.created_at DESC") && sql.includes("brand_fact_version"));
  const plan = await db.query((db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ") + listQuery.sql, listQuery.values);
  assert.match(JSON.stringify(plan), /fact_version_recent_idx/);
  console.log(`${db.kind} recent fact plan ${JSON.stringify(plan)}`);
  const second = await readFactWorkspace(db, scope, { after: first.versions.next }, clock());
  assert.ok(second.versions.items.every(({ id }) => !first.versions.items.some((item) => id === item.id)));
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: fact approval, replacement, original revisions and use survive reopen and migration`, async () => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    const ddl = await testDatabase(kind, { ddl: true });
    let reopened;
    try {
      const db = fixture.connection;
      await migrateThrough(db, kind === "sqlite" ? "0006_normal_shen" : "0007_mighty_jimmy_woo");
      const scope = await addBrand(db);
      const other = await addBrand(db);
      for (let i = 0; i < 2; i++) {
        execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, ...fixture.env }, stdio: "pipe" });
      }
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const run = (command) => executeFactCommand(db, scope, command, clock());
      const read = (query, at = time) => readFactWorkspace(db, scope, query, clock(at));
      const originalId = randomUUID();
      const save = { action: "savePaste", id: originalId, previousId: null, original: paste };
      assert.deepEqual(await run(save), { id: originalId });
      assert.deepEqual(await run(save), { id: originalId });
      assert.deepEqual(await run({ ...save, original: paste + "changed" }), { error: "conflict" });
      assert.equal((await run({ ...save, id: randomUUID(), original: "🙂".repeat(20_001) })).error, "invalidInput");
      const maxId = randomUUID();
      assert.deepEqual(await run({ ...save, id: maxId, original: "🙂".repeat(20_000) }), { id: maxId });
      const revisionId = randomUUID();
      assert.deepEqual(await run({ ...save, id: revisionId, previousId: originalId, original: paste + " v2" }), { id: revisionId });
      assert.equal((await run({ ...save, id: randomUUID(), previousId: originalId })).error, "conflict");
      assert.equal((await read({ paste: originalId })).successor, revisionId);
      assert.equal((await read({ paste: originalId })).paste.original, paste);

      const candidate = randomUUID();
      const { start, end } = previewPaste(paste).segments[0];
      const draft = { ...emptyFields, category: "price", title: usable.title, claim: usable.claim, pasteId: originalId, pasteSpan: [start, end] };
      const create = { action: "create", id: candidate, previousId: null, fields: draft };
      assert.deepEqual(await run(create), { id: candidate });
      assert.deepEqual(await run(create), { id: candidate });
      assert.deepEqual(await run({ action: "submit", id: candidate, revision: 1 }), { id: candidate });
      const approve = { action: "approve", id: candidate, revision: 2, confirmed: true, conflictId: null, revokeConflict: false };
      assert.equal((await run({ ...approve, confirmed: false })).error, "invalidInput");
      assert.deepEqual(await run(approve), { error: "evidenceRequired", gaps: ["sourceMissing", "permissionMissing", "validityMissing"] });
      assert.equal(await readFactWorkspace(db, { ...scope, ownerId: other.ownerId }, { fact: candidate }), null);
      assert.equal((await executeFactCommand(db, other, { ...create, id: randomUUID() }, clock())).error, "notFound");
      assert.equal((await executeFactCommand(db, { ...scope, ownerId: other.ownerId }, approve, clock())).error, "notFound");
      assert.deepEqual(await run({ action: "edit", id: candidate, revision: 2, fields: { ...usable, pasteId: originalId, pasteSpan: [start, end] } }), { id: candidate });

      const cfg = parseDatabaseConfig(fixture.env);
      assert.ok(cfg.success);
      reopened = openConnection(cfg.data);
      const restored = await readFactWorkspace(reopened, scope, { paste: originalId, fact: candidate }, clock());
      assert.equal(restored.fact.fields.sourceReference, secret);
      assert.equal(restored.paste.original, paste);
      const concurrent = await Promise.all([run({ ...approve, revision: 3 }), run({ ...approve, revision: 3 })]);
      assert.equal(concurrent.filter((result) => result.id === candidate).length, 1);
      assert.equal(concurrent.filter((result) => result.error === "conflict").length, 1);
      const originalFact = (await read({ fact: candidate })).fact;
      assert.equal(originalFact.confirmedBy, scope.ownerId);
      assert.equal(originalFact.confirmedAt, time);
      assert.equal(reviewDue(originalFact), "2026-12-18T08:00:00.000Z");

      const contentVersionId = randomUUID();
      const bind = { factVersionIds: [candidate], contentVersionId, stage: "delivery" };
      await assert.rejects(withEligibleFacts(db, scope, bind, async () => { throw new Error("fixture rollback"); }, clock()), /fixture rollback/);
      assert.equal((await read({ fact: candidate })).impacts.length, 0);
      const projection = await withEligibleFacts(db, scope, bind, async (_tx, facts) => facts, clock());
      assert.deepEqual(projection.data, [{ id: candidate, factId: candidate, version: 1, claim: usable.claim }]);
      assert.doesNotMatch(JSON.stringify(projection), /Private evidence|Internal attachment|合成规格/);
      assert.equal((await withEligibleFacts(db, scope, bind, async () => "unexpected", clock("2027-01-01T00:00:00.000Z"))).error, "factInvalid");
      const historicalId = randomUUID();
      await withEligibleFacts(db, scope, { ...bind, contentVersionId: historicalId, stage: "history" }, async () => null, clock());

      const replacement = randomUUID();
      const updated = { ...usable, claim: "Synthetic 120 CNY", validity: "longTerm", validThrough: "" };
      assert.deepEqual(await run({ action: "create", id: replacement, previousId: candidate, fields: updated }), { id: replacement });
      const pending = await read({ fact: replacement });
      assert.equal(pending.fact.state, "pending_confirmation");
      assert.equal(pending.conflict.id, candidate);
      assert.deepEqual(pending.conflict.claim, usable.claim);
      assert.deepEqual((await read({ fact: candidate })).fact, originalFact);
      assert.equal((await run({ ...approve, id: replacement, revision: 1 })).error, "conflict");
      assert.deepEqual(await run({ ...approve, id: replacement, revision: 1, conflictId: candidate, revokeConflict: true }), { id: replacement });

      const history = await read({ fact: candidate, paste: originalId });
      assert.equal(history.fact.state, "revoked");
      assert.equal(history.fact.confirmedAt, originalFact.confirmedAt);
      assert.equal(history.fact.fields.claim, usable.claim);
      assert.equal(history.impacts.find((row) => row.contentVersionId === contentVersionId).effect, "invalid");
      assert.equal(history.impacts.find((row) => row.contentVersionId === historicalId).effect, "historical");
      assert.equal((await withEligibleFacts(db, scope, bind, async () => "unexpected", clock())).error, "factInvalid");
      assert.equal((await withEligibleFacts(db, scope, { ...bind, factVersionIds: [replacement] }, async () => "unexpected", clock())).error, "conflict");

      await checkBatch(db, scope, candidate);
      await queryWithParameters(db, "UPDATE brand SET frozen_at = ?, restore_until = ? WHERE id = ?", [time, time, scope.brandId]);
      assert.equal(await read({ fact: candidate }), null);
      assert.equal((await run(save)).error, "notFound");
      assert.equal((await withEligibleFacts(db, scope, bind, async () => "unexpected", clock())).error, "notFound");
      await db.transaction((tx) => new PurgeDao(tx).clearContents(scope, time));
      for (const table of ["brand_fact_version", "brand_fact_paste", "brand_fact_use"]) {
        assert.deepEqual(await queryWithParameters(db, `SELECT brand_id FROM ${table} WHERE brand_id = ?`, [scope.brandId]), []);
      }
    } finally {
      await reopened?.close();
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
