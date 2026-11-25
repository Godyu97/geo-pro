import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { memoryCache } from "../../src/lib/cache/store.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { listBriefs, resumeBatch } from "../../src/features/content/commands.ts";
import { readEvidenceOverview } from "../../src/features/evidence/overview-commands.ts";
import { executeMonitoringRun } from "../../src/features/monitoring/execution.ts";
import { readStoredObject } from "../../src/features/stored-objects/commands.ts";
import { authorizeBrandActor, workspaceBrand } from "../../src/features/team-access/brand-scope.ts";
import { exportGrantedBrands, grantBrandMember, revokeBrandGrant } from "../../src/features/team-access/commands.ts";
import { brandActorQuery } from "../../src/features/team-access/dao.ts";
import { brandDutyAllows } from "../../src/features/team-access/rules.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-26T00:00:00.000Z";
const later = "2026-12-01T00:00:00.000Z";
const nameA = "品牌甲私密名称合成";
const nameB = "品牌乙私密名称合成";
const attachmentA = "品牌甲附件合成不可泄露";
const attachmentB = "品牌乙附件合成不可泄露";

test("brand duty matrix keeps read-only off writes and downloads", () => {
  assert.equal(brandDutyAllows("owner", "download"), true);
  assert.equal(brandDutyAllows("member", "write"), true);
  assert.equal(brandDutyAllows("read_only", "read"), true);
  assert.equal(brandDutyAllows("read_only", "write"), false);
  assert.equal(brandDutyAllows("read_only", "download"), false);
});

function hidden(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(nameB), false);
  assert.equal(text.includes(attachmentB), false);
  return text;
}

async function addUser(db, id) {
  await queryWithParameters(db, 'INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)', [
    id, "团队成员夹具", `${id}@example.invalid`,
  ]);
}

async function addBrand(db, ownerId, id, name) {
  await queryWithParameters(db, `INSERT INTO brand (id, owner_id, status, revision, entity_version, created_at)
    VALUES (?, ?, 'active', 1, 1, ?)`, [id, ownerId, time]);
  await queryWithParameters(db, `INSERT INTO brand_version (brand_id, version, name, content, created_at)
    VALUES (?, 1, ?, ?, ?)`, [id, name, JSON.stringify({ name, website: "" }), time]);
}

async function addPausedBatch(db, ownerId, brandId) {
  const id = randomUUID();
  const ledger = JSON.stringify({
    mode: "unknown_pending", reservationId: null, attempts: [], upperMinor: 0, currency: "CNY",
  });
  await queryWithParameters(db, `INSERT INTO content_batch (
      id, brand_id, owner_id, status, reservation_id, operation_id, cost_ledger_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'paused', NULL, ?, ?, ?, ?)`, [id, brandId, ownerId, randomUUID(), ledger, time, time]);
  return id;
}

async function addRun(db, ownerId, brandId) {
  const runId = randomUUID();
  const slotId = randomUUID();
  const fingerprint = createHash("sha256").update(runId).digest("hex");
  await queryWithParameters(db, `INSERT INTO monitoring_run (
      id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
      repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
      requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
      status, sampling_complete, created_at
    ) VALUES (?, ?, ?, ?, ?, 'consumer_ui', ?, 1, 1, 1, 1, 1, 1, 'CN', 'zh-CN', 'unknown', NULL, NULL, NULL, 0, 'queued', 0, ?)`, [
    runId, brandId, ownerId, randomUUID(), fingerprint, randomUUID(), time,
  ]);
  await queryWithParameters(db, `INSERT INTO monitoring_slot (
      id, run_id, brand_id, question_id, natural_question, channel_id, channel_version,
      repeat_index, reservation_id, status, created_at, adopted_attempt_id, late
    ) VALUES (?, ?, ?, ?, 1, ?, 1, 1, NULL, 'queued', ?, NULL, 0)`, [
    slotId, runId, brandId, randomUUID(), randomUUID(), time,
  ]);
  return runId;
}

function objectStorage(body, sha) {
  return {
    async getObject() {
      return { ok: true, body, byteSize: body.byteLength, sha256: sha };
    },
    async deleteObject() {
      return { ok: true };
    },
    async putAndReadBack() {
      return { ok: false, code: "failed" };
    },
    async presignGet() {
      return { ok: false, code: "failed" };
    },
  };
}

async function addObject(db, ownerId, brandId, bodyText) {
  const id = randomUUID();
  const body = new TextEncoder().encode(bodyText);
  const sha = createHash("sha256").update(body).digest("hex");
  const key = `v1/${ownerId}/${brandId}/internal-material/${id}/note.txt`;
  await queryWithParameters(db, `INSERT INTO stored_object (
      id, owner_id, brand_id, "class", visibility, status, bucket, object_key, content_type,
      byte_size, sha256, file_name, immutable, created_at, ready_at, deleted_at
    ) VALUES (?, ?, ?, 'internal-material', 'internal', 'ready', 'app-files', ?, 'text/plain',
      ?, ?, 'note.txt', 0, ?, ?, NULL)`, [id, ownerId, brandId, key, body.byteLength, sha, time, time]);
  return { id, storage: objectStorage(body, sha) };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: granted members use brand A and lose queued work after revoke`, async () => {
    const fixture = await testDatabase(kind);
    const ddl = await testDatabase(kind, { ddl: true });
    try {
      const db = fixture.connection;
      assert.deepEqual(await structure(db), await structure(ddl.connection));
      const ownerA = randomUUID();
      const ownerB = randomUUID();
      const member = randomUUID();
      const reader = randomUUID();
      const brandA = randomUUID();
      const brandB = randomUUID();
      await addUser(db, ownerA);
      await addUser(db, ownerB);
      await addUser(db, member);
      await addUser(db, reader);
      await addBrand(db, ownerA, brandA, nameA);
      await addBrand(db, ownerB, brandB, nameB);

      const granted = await grantBrandMember(db, ownerA, {
        userId: member, brandId: brandA, role: "member", expiresAt: null,
      }, time);
      assert.equal(granted.grant.role, "member");
      const readOnly = await grantBrandMember(db, ownerA, {
        userId: reader, brandId: brandA, role: "read_only", expiresAt: later,
      }, time);
      assert.equal(readOnly.grant.role, "read_only");
      assert.equal(readOnly.action, null);

      const scope = await workspaceBrand(db, member, undefined, "read", time);
      assert.equal(scope?.brandId, brandA);
      assert.equal(await workspaceBrand(db, member, brandB, "read", time), null);
      hidden(await workspaceBrand(db, member, brandB, "read", time));

      const briefs = await listBriefs(db, member, brandA);
      assert.equal("error" in briefs, false);
      hidden(briefs);
      const deniedBriefs = await listBriefs(db, member, brandB);
      assert.deepEqual(deniedBriefs, { error: "NOT_FOUND" });
      hidden(deniedBriefs);

      const overview = await readEvidenceOverview(db, member, { brandId: brandA, sourceMode: "model_api" }, memoryCache(), () => time);
      assert.equal("error" in overview, false);
      if ("error" in overview) return;
      assert.equal(overview.scope.brandName, nameA);
      assert.equal(JSON.stringify(overview).includes(nameB), false);
      const deniedOverview = await readEvidenceOverview(db, member, { brandId: brandB, sourceMode: "model_api" }, memoryCache(), () => time);
      assert.deepEqual(deniedOverview, { error: "NOT_FOUND" });
      hidden(deniedOverview);

      const mixed = await exportGrantedBrands(db, member, [brandA, brandB], time);
      assert.deepEqual(mixed, { allowed: false, rows: [] });
      hidden(mixed);
      const readerExport = await exportGrantedBrands(db, reader, [brandA], time);
      assert.deepEqual(readerExport, { allowed: false, rows: [] });
      hidden(readerExport);

      const paused = await addPausedBatch(db, ownerA, brandA);
      const resumed = await resumeBatch(db, member, { brandId: brandA, batchId: paused }, () => time);
      assert.equal(resumed.status, "completed");
      const blockedResume = await resumeBatch(db, reader, { brandId: brandA, batchId: paused }, () => time);
      assert.equal(blockedResume.error, "NOT_FOUND");

      const runId = await addRun(db, ownerA, brandA);
      const transport = { label: "isolated" };
      const executed = await executeMonitoringRun(db, member, runId, transport, () => time);
      assert.equal(executed.error, "CHANNEL_UNVERIFIED");
      const [ran] = await queryWithParameters(db, `SELECT status FROM monitoring_run WHERE id = ?`, [runId]);
      assert.equal(ran.status, "paused");

      const fileA = await addObject(db, ownerA, brandA, attachmentA);
      const fileB = await addObject(db, ownerB, brandB, attachmentB);
      const opened = await readStoredObject(db, { actorId: member, objectId: fileA.id }, { storage: fileA.storage });
      assert.equal(opened.ok, true);
      assert.equal(new TextDecoder().decode(opened.body), attachmentA);
      const otherFile = await readStoredObject(db, { actorId: member, objectId: fileB.id }, { storage: fileB.storage });
      assert.deepEqual(otherFile, { ok: false, code: "not-found" });
      hidden(otherFile);
      const readerFile = await readStoredObject(db, { actorId: reader, objectId: fileA.id }, { storage: fileA.storage });
      assert.deepEqual(readerFile, { ok: false, code: "not-found" });
      assert.equal(JSON.stringify(readerFile).includes(attachmentA), false);

      const revoked = await revokeBrandGrant(db, ownerA, granted.grant.id, time);
      assert.equal(revoked.grant.active, 0);
      const stoppedBatch = await addPausedBatch(db, ownerA, brandA);
      const afterRevoke = await resumeBatch(db, member, { brandId: brandA, batchId: stoppedBatch }, () => time);
      assert.deepEqual(afterRevoke, { error: "NOT_FOUND" });
      const [stillPaused] = await queryWithParameters(db, `SELECT status FROM content_batch WHERE id = ?`, [stoppedBatch]);
      assert.equal(stillPaused.status, "paused");
      const stoppedRun = await addRun(db, ownerA, brandA);
      const stoppedExecute = await executeMonitoringRun(db, member, stoppedRun, transport, () => time);
      assert.equal(stoppedExecute.error, "NOT_FOUND");
      const [untouched] = await queryWithParameters(db, `SELECT status FROM monitoring_run WHERE id = ?`, [stoppedRun]);
      assert.equal(untouched.status, "queued");
      const closedFile = await readStoredObject(db, { actorId: member, objectId: fileA.id }, { storage: fileA.storage });
      assert.deepEqual(closedFile, { ok: false, code: "not-found" });
      assert.equal(JSON.stringify(closedFile).includes(attachmentA), false);

      await queryWithParameters(db, `UPDATE brand_member_grant SET expires_at = ? WHERE id = ?`, [time, readOnly.grant.id]);
      assert.equal(await authorizeBrandActor(db, reader, brandA, "read", later), null);
      const expiredBriefs = await listBriefs(db, reader, brandA, 20, later);
      assert.deepEqual(expiredBriefs, { error: "NOT_FOUND" });
      hidden(expiredBriefs);

      if (db.kind === "postgresql") await db.query("ANALYZE brand_member_grant");
      const lookup = brandActorQuery(member, brandA);
      const plan = db.kind === "postgresql"
        ? JSON.stringify(await db.transaction(async (tx) => {
          await tx.query("SET LOCAL enable_seqscan = off");
          return queryWithParameters(tx, `EXPLAIN (COSTS OFF) ${lookup.sql}`, lookup.values);
        }))
        : JSON.stringify(await queryWithParameters(db, `EXPLAIN QUERY PLAN ${lookup.sql}`, lookup.values));
      assert.match(plan, /brand_member_grant_pair_uidx|brand_member_grant_brand_idx/);
      if (db.kind === "postgresql") assert.doesNotMatch(plan, /Seq Scan on brand_member_grant/);
    } finally {
      await fixture.cleanup();
      await ddl.cleanup();
    }
  });
}
