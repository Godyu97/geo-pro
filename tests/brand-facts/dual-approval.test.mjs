import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { saveApprovalPolicy } from "../../src/features/approval-policy/commands.ts";
import { executeFactCommand, readFactWorkspace } from "../../src/features/brand-facts/service.ts";
import { emptyFields } from "../../src/features/brand-facts/rules.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-22T12:00:00.000Z";
const factClock = () => new Date(time);
const usableFact = {
  ...emptyFields,
  category: "price",
  title: "Synthetic plan price",
  claim: "事实主张机密合成不可外泄",
  sourceType: "url",
  sourceReference: "https://ding.example.com/pricing",
  sourceLocator: "Section 1",
  sourceExcerpt: "Public price excerpt",
  sourceDate: "2026-11-18",
  permission: "public",
  validity: "dated",
  validThrough: "2026-12-31",
};

async function addUser(db, id) {
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "审核夹具", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
}

async function addBrand(db, ownerId, id) {
  const brands = new BrandDao(db);
  await brands.insertBrand(ownerId, id, time);
  await brands.insertVersion(id, 1, {
    name: "品牌私密名称合成",
    description: "Synthetic brand",
    website: "https://ding.example.com",
    aliases: ["丁"],
    region: "CN",
    language: "zh-CN",
    competitors: [],
    questions: [],
  }, time);
}

function run(db, ownerId, brandId, command) {
  return executeFactCommand(db, { ownerId, brandId }, command, factClock);
}

async function factRow(db, brandId, factId) {
  const [row] = await queryWithParameters(db, `SELECT state, content, confirmed_by AS "confirmedBy"
    FROM brand_fact_version WHERE brand_id = ? AND id = ?`, [brandId, factId]);
  return row;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: fact approval follows dual control and keeps the single-owner path`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const db = fixture.connection;
      const owner = randomUUID();
      const factUser = randomUUID();
      const reviewer = randomUUID();
      const stranger = randomUUID();
      const brand = randomUUID();
      await addUser(db, owner);
      await addUser(db, factUser);
      await addUser(db, reviewer);
      await addUser(db, stranger);
      await addBrand(db, owner, brand);

      const historicalId = randomUUID();
      assert.deepEqual(await run(db, owner, brand, {
        action: "create", id: historicalId, previousId: null, fields: usableFact,
      }), { id: historicalId });
      assert.deepEqual(await run(db, owner, brand, { action: "submit", id: historicalId, revision: 1 }), { id: historicalId });
      assert.deepEqual(await run(db, owner, brand, {
        action: "approve", id: historicalId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
      }), { id: historicalId });
      const historical = await factRow(db, brand, historicalId);
      assert.equal(historical.state, "approved");
      assert.equal(historical.confirmedBy, owner);

      const saved = await saveApprovalPolicy(db, owner, {
        brandId: brand,
        dualControl: true,
        duties: [
          { userId: factUser, factApprover: true, contentApprover: false },
          { userId: reviewer, factApprover: false, contentApprover: true },
        ],
      }, time);
      assert.equal(saved.dualControl, true);
      assert.deepEqual(await factRow(db, brand, historicalId), historical);

      const pendingId = randomUUID();
      assert.deepEqual(await run(db, owner, brand, {
        action: "create", id: pendingId, previousId: null, fields: { ...usableFact, claim: "另一条事实主张" },
      }), { id: pendingId });
      assert.deepEqual(await run(db, owner, brand, { action: "submit", id: pendingId, revision: 1 }), { id: pendingId });
      const pendingBefore = await factRow(db, brand, pendingId);
      const approve = {
        action: "approve", id: pendingId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
      };
      assert.equal((await run(db, owner, brand, approve)).error, "separation");
      assert.equal((await factRow(db, brand, pendingId)).state, "pending_confirmation");
      assert.equal((await factRow(db, brand, pendingId)).content, pendingBefore.content);
      assert.equal((await run(db, reviewer, brand, approve)).error, "duty");
      assert.equal((await factRow(db, brand, pendingId)).content, pendingBefore.content);
      assert.deepEqual(await run(db, stranger, brand, approve), { error: "notFound" });
      assert.deepEqual(await run(db, factUser, brand, approve), { id: pendingId });
      const approved = await factRow(db, brand, pendingId);
      assert.equal(approved.state, "approved");
      assert.equal(approved.confirmedBy, factUser);
      assert.equal(approved.content, pendingBefore.content);
      assert.deepEqual(await factRow(db, brand, historicalId), historical);

      const workspace = await readFactWorkspace(db, { ownerId: factUser, brandId: brand }, { fact: pendingId }, factClock);
      assert.equal(workspace?.fact?.id, pendingId);
      assert.equal(await readFactWorkspace(db, { ownerId: reviewer, brandId: brand }, {}, factClock), null);

      const attempts = await queryWithParameters(db, `SELECT reason FROM approval_attempt
        WHERE brand_id = ? AND version_id = ? ORDER BY created_at, id`, [brand, pendingId]);
      assert.deepEqual(attempts.map((row) => row.reason).sort(), ["duty", "separation"]);

      await saveApprovalPolicy(db, owner, {
        brandId: brand,
        dualControl: false,
        duties: [{ userId: factUser, factApprover: true, contentApprover: false }],
      }, time);
      const laterId = randomUUID();
      assert.deepEqual(await run(db, owner, brand, {
        action: "create", id: laterId, previousId: null, fields: { ...usableFact, claim: "关闭双人后的事实" },
      }), { id: laterId });
      assert.deepEqual(await run(db, owner, brand, { action: "submit", id: laterId, revision: 1 }), { id: laterId });
      assert.deepEqual(await run(db, owner, brand, {
        action: "approve", id: laterId, revision: 2, confirmed: true, conflictId: null, revokeConflict: false,
      }), { id: laterId });
      assert.equal((await factRow(db, brand, laterId)).confirmedBy, owner);
      assert.deepEqual(await factRow(db, brand, historicalId), historical);
    } finally {
      await fixture.cleanup();
    }
  });
}
