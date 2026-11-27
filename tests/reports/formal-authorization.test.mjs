import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  appendFormalConfounder,
  createFormalObservation,
  listFormalConfounders,
  listFormalControls,
  listFormalObservations,
  readFormalObservation,
  recordFormalCheckpoint,
  registerFormalControl,
  stopFormalObservation,
} from "../../src/features/formal-retest/commands.ts";
import {
  createInterventionBatch,
  getInterventionBatch,
  listInterventionBatches,
  registerInterventionPage,
} from "../../src/features/formal-retest/intervention-commands.ts";
import { grantBrandMember, revokeBrandGrant } from "../../src/features/team-access/commands.ts";
import { ensurePersonalGroup } from "../../src/features/team-access/platform-role.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const at = "2026-11-27T08:00:00.000Z";
const clock = () => at;

async function account(db, name) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, name, `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function brand(db, owner) {
  const id = randomUUID();
  const group = await ensurePersonalGroup(db, owner, at);
  await new BrandDao(db).insertBrand(owner, id, at, group);
  return id;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: formal retest reads and writes follow brand grants and preserve observation history`, async (t) => {
    const fixture = await testDatabase(kind);
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    const owner = await account(db, "Owner");
    const member = await account(db, "Member");
    const readOnly = await account(db, "Read only");
    const outsider = await account(db, "Outsider");
    const otherOwner = await account(db, "Other owner");
    const brandId = await brand(db, owner);
    const otherBrandId = await brand(db, otherOwner);
    const memberGrant = await grantBrandMember(db, owner, {
      userId: member, brandId, role: "member", expiresAt: null,
    }, at);
    assert.ok(memberGrant.grant);
    assert.ok((await grantBrandMember(db, owner, {
      userId: readOnly, brandId, role: "read_only", expiresAt: null,
    }, at)).grant);
    assert.ok((await grantBrandMember(db, otherOwner, {
      userId: member, brandId: otherBrandId, role: "member", expiresAt: null,
    }, at)).grant);

    const input = { brandId, frozenSetId: "frozen-set", frozenNonBrandCount: 30, effectiveOn: "2026-11-17" };
    const { observation } = await createFormalObservation(db, owner, input, clock);
    const observationId = observation.id;
    const { observation: otherObservation } = await createFormalObservation(db, member, { ...input, brandId: otherBrandId }, clock);
    assert.deepEqual(await listFormalObservations(db, otherOwner, otherBrandId), { observations: [otherObservation] });
    const { batch } = await createInterventionBatch(db, member, { brandId }, clock);
    const batchId = batch.id;
    const { batch: verified } = await registerInterventionPage(db, member, { id: batchId, brandId }, {
      pageKey: "/publication", verifiedAt: "2026-11-10T12:00:00.000Z",
    }, clock);
    assert.equal(verified.status, "effective");
    assert.deepEqual(await listInterventionBatches(db, owner, brandId), { batches: [verified] });
    assert.deepEqual(await listInterventionBatches(db, member, otherBrandId), { batches: [] });

    const control = { pageKey: "/unchanged", label: "observation" };
    const note = { factor: "model", note: "Model version changed" };
    const checkpointInput = { checkpoint: "d7", today: "2026-11-27", requestedMode: "formal" };
    const reason = { reason: "Window closed" };
    const { controls } = await registerFormalControl(db, member, { id: observationId, brandId }, control, clock);
    const { confounders } = await appendFormalConfounder(db, member, { id: observationId, brandId }, note, clock);
    assert.equal(controls[0].pageKey, control.pageKey);
    assert.equal(confounders[0].note, note.note);
    const { checkpoint } = await recordFormalCheckpoint(db, member, observationId, checkpointInput, clock);
    assert.equal(checkpoint.mode, "exploratory");
    assert.ok(checkpoint.evaluation.insufficiencyReasons.includes("baseline_intervention"));
    const { observation: stopped } = await stopFormalObservation(db, member, observationId, reason, clock);
    assert.equal(stopped.baseline.interventionCount, 1);
    assert.deepEqual(stopped.checkpoints, [checkpoint]);

    const writePage = { pageKey: "/other", verifiedAt: null };
    assert.deepEqual(await registerInterventionPage(db, member, { id: batchId, brandId: otherBrandId }, writePage, clock),
      { error: "NOT_FOUND" });
    assert.deepEqual(await appendFormalConfounder(db, member, { id: observationId, brandId: otherBrandId }, note, clock),
      { error: "NOT_FOUND" });

    const reads = (actor) => [
      () => listFormalObservations(db, actor, brandId),
      () => readFormalObservation(db, actor, observationId),
      () => listFormalControls(db, actor, observationId),
      () => listFormalConfounders(db, actor, observationId),
      () => listInterventionBatches(db, actor, brandId),
      () => getInterventionBatch(db, actor, batchId),
    ];
    const writes = (actor) => [
      () => createFormalObservation(db, actor, input, clock),
      () => recordFormalCheckpoint(db, actor, observationId, checkpointInput, clock),
      () => appendFormalConfounder(db, actor, observationId, note, clock),
      () => registerFormalControl(db, actor, observationId, control, clock),
      () => stopFormalObservation(db, actor, observationId, reason, clock),
      () => createInterventionBatch(db, actor, { brandId }, clock),
      () => registerInterventionPage(db, actor, batchId, writePage, clock),
    ];
    const expected = [{ observations: [stopped] }, { observation: stopped }, { controls }, { confounders },
      { batches: [verified] }, { batch: verified }];
    assert.deepEqual(await Promise.all(reads(readOnly).map(read => read())), expected);
    for (const write of writes(readOnly)) assert.deepEqual(await write(), { error: "FORBIDDEN" });
    for (const call of [...reads(outsider), ...writes(outsider)]) assert.deepEqual(await call(), { error: "NOT_FOUND" });

    assert.ok((await revokeBrandGrant(db, owner, memberGrant.grant.id, at)).grant);
    for (const call of [...reads(member), ...writes(member)]) assert.deepEqual(await call(), { error: "NOT_FOUND" });
    assert.deepEqual(await Promise.all(reads(owner).map(read => read())), expected);
  });
}
