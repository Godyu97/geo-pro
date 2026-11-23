import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import {
  createSamplingProtocol,
  freezeSamplingProtocol,
  listSamplingProtocols,
  pinSamplingProtocol,
} from "../../src/features/monitoring/protocol-commands.ts";
import {
  createSamplingProtocolSchema,
  freezeSamplingProtocolSchema,
  pinSamplingProtocolSchema,
  samplingProtocolErrors,
} from "../../src/features/monitoring/protocol-contracts.ts";
import {
  SamplingProtocolDao,
  samplingProtocolFamilyQuery,
  samplingProtocolPinsForOwnerQuery,
  samplingProtocolsForOwnerQuery,
} from "../../src/features/monitoring/protocol-dao.ts";
import { samplingProtocolFingerprint } from "../../src/features/monitoring/protocol.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const region = "QL";
const timezone = "Pacific/Kiritimati";
const nextTimezone = "Asia/Shanghai";
const fields = {
  newSessionRequired: true,
  searchRequired: true,
  targetRegion: region,
  timezone,
};

test("sampling protocol input rejects drafts, extra network fields, and unsafe return paths", () => {
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const operationId = "4160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  assert.equal(createSamplingProtocolSchema.safeParse({ operationId, brandId, ...fields }).success, true);
  assert.equal(createSamplingProtocolSchema.safeParse({ operationId, brandId, ...fields, facts: "品牌事实" }).success, false);
  assert.equal(freezeSamplingProtocolSchema.safeParse({ operationId, ...fields, searchTriggered: true }).success, false);
  assert.equal(pinSamplingProtocolSchema.safeParse({ protocolId: brandId, version: 1 }).success, true);
  assert.equal(pinSamplingProtocolSchema.safeParse({ protocolId: brandId, version: 1, searchTriggered: true }).success, false);
  assert.equal(pinSamplingProtocolSchema.safeParse({ protocolId: brandId, version: 1, requestedNetworkMode: "on" }).success, false);
  assert.equal(samplingProtocolErrors.NOT_FROZEN, 409);
  assert.equal(samplingProtocolErrors.NOT_FOUND, 404);
  assert.equal(safeReturnTo("/dashboard/monitoring/protocols"), "/dashboard/monitoring/protocols");
  assert.equal(samplingProtocolFingerprint(fields), samplingProtocolFingerprint({ ...fields, searchRequired: true }));
  assert.notEqual(samplingProtocolFingerprint(fields), samplingProtocolFingerprint({ ...fields, timezone: nextTimezone }));
});

test("sampling protocol copy keeps versions frozen and does not claim search was triggered", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.samplingProtocols.description, /未冻结/);
  assert.match(zhCN.samplingProtocols.description, /新增版本/);
  assert.match(zhCN.samplingProtocols.description, /不会改写成运行已经触发联网/);
  assert.match(zhCN.samplingProtocols.NOT_FROZEN, /不能钉到运行/);
  assert.match(en.samplingProtocols.description, /draft protocol cannot be pinned/i);
  assert.match(en.samplingProtocols.description, /adds a version/i);
  assert.match(en.samplingProtocols.description, /not rewritten as search already triggered/i);
  assert.equal(JSON.stringify(zhCN.samplingProtocols).includes(timezone), false);
  assert.equal(JSON.stringify(en.samplingProtocols).includes(region), false);
  assert.equal(zhCN.evidenceOverview.openProtocols.length > 0, true);
  assert.equal(en.evidenceOverview.openProtocols.length > 0, true);
  const page = await readFile(new URL("../../src/features/monitoring/protocols-page.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../../src/features/monitoring/protocols-panel.tsx", import.meta.url), "utf8");
  const source = await readFile(new URL("../../src/features/monitoring/protocol-commands.ts", import.meta.url), "utf8");
  assert.equal(page.includes("description") && page.includes("fixtureNote"), true);
  assert.equal(panel.includes(timezone), false);
  assert.equal(source.includes("createAiResponse"), false);
  assert.equal(source.includes("UPDATE monitoring_run"), false);
  assert.equal(source.includes("search_triggered"), false);
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

function clockFrom(start) {
  let step = 0;
  return () => new Date(Date.parse(start) + step++ * 60_000).toISOString();
}

function isSelect(sql, table) {
  return /^\s*select/i.test(sql) && new RegExp(`\\b${table}\\b`, "i").test(sql);
}

function writes(captured, table) {
  return captured.filter((item) => new RegExp(`^\\s*(insert|update|delete)[\\s\\S]*\\b${table}\\b`, "i").test(item.sql));
}

function tableSql(shape, table) {
  if (Array.isArray(shape)) {
    return shape
      .filter((row) => row.tbl_name === table)
      .map((row) => row.sql ?? "")
      .join("\n")
      .toLowerCase();
  }
  return shape.columns
    .filter((row) => row.table_name === table)
    .map((row) => row.column_name)
    .join(",")
    .toLowerCase();
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Sampling protocol owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function countBy(db, table, column, value) {
  const [row] = await queryWithParameters(
    db,
    `SELECT count(*) AS "total" FROM ${table} WHERE ${column} = ?`,
    [value],
  );
  return Number(row.total);
}

async function insertRun(db, ownerId, brandId, createdAt) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    `INSERT INTO monitoring_run (
      id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
      repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
      requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
      status, sampling_complete, created_at
    ) VALUES (?, ?, ?, ?, ?, 'consumer_ui', ?, 1, 1, 1, 0, 1, 1, 'CN', 'zh-CN', 'off', NULL, NULL, NULL, 0, 'queued', 0, ?)`,
    [id, brandId, ownerId, randomUUID(), "a".repeat(64), randomUUID(), createdAt],
  );
  return id;
}

async function runSnapshot(db, runId) {
  const [row] = await queryWithParameters(
    db,
    `SELECT requested_network_mode AS "requestedNetworkMode", customer_payable_minor AS "customerPayableMinor", status
      FROM monitoring_run WHERE id = ?`,
    [runId],
  );
  return row;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: frozen protocol versions stay pinned and drafts do not`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        for (const name of [
          "sampling_protocol_version_key",
          "sampling_protocol_fingerprint_uidx",
          "sampling_protocol_operation_uidx",
          "sampling_protocol_owner_idx",
          "sampling_protocol_family_idx",
          "sampling_protocol_state_check",
          "run_protocol_pin_owner_idx",
          "run_protocol_pin_state_check",
        ]) {
          assert.match(defined, new RegExp(name));
        }
        if (db.kind === "postgresql") {
          assert.match(defined, /run_protocol_pin_run_fk/);
          assert.match(defined, /run_protocol_pin_protocol_fk/);
        } else {
          assert.match(defined, /FOREIGN KEY \(`run_id`\) REFERENCES `monitoring_run`/);
          assert.match(defined, /FOREIGN KEY \(`protocol_id`,`version`\) REFERENCES `sampling_protocol`/);
        }
        const protocolColumns = tableSql(migrated, "sampling_protocol");
        const pinColumns = tableSql(migrated, "run_protocol_pin");
        for (const word of ["password", "token", "secret", "cookie", "search_triggered", "requested_network_mode", "prompt"]) {
          assert.equal(protocolColumns.includes(word), false, word);
          assert.equal(pinColumns.includes(word), false, word);
        }
        assert.equal(protocolColumns.includes("search_required"), true);
        assert.equal(protocolColumns.includes("target_region"), true);
        assert.equal(pinColumns.includes("version"), true);

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        await brands.insertVersion(brand, 1, {
          ...initialBrandFields,
          name: "合成采样品牌",
          description: "合成品牌资料，仅用于协议钉选",
        }, time);
        await brands.insertVersion(otherBrand, 1, {
          ...initialBrandFields,
          name: "合成对照品牌",
          description: "合成品牌资料，仅用于协议隔离",
        }, time);
        const clock = clockFrom(time);
        const pinnedRun = await insertRun(db, owner, brand, time);
        const bareRun = await insertRun(db, owner, brand, time);
        const beforeRun = await runSnapshot(db, pinnedRun);
        const protocolCount = () => countBy(db, "sampling_protocol", "protocol_id", created.protocol.protocolId);
        const pinCount = () => countBy(db, "run_protocol_pin", "run_id", pinnedRun);

        const created = await createSamplingProtocol(db, owner, {
          operationId: randomUUID(),
          brandId: brand,
          ...fields,
        }, clock);
        assert.equal(created.protocol.status, "draft");
        assert.equal(created.protocol.version, 1);
        assert.equal(created.protocol.searchRequired, true);
        assert.equal(await protocolCount(), 1);
        const dao = new SamplingProtocolDao(db);
        assert.equal(await dao.latestFrozenForBrand(owner, brand), null);
        const hidden = await createSamplingProtocol(db, outsider, {
          operationId: randomUUID(),
          brandId: brand,
          ...fields,
        }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });

        const blockedWatch = watch(db);
        const blocked = await pinSamplingProtocol(blockedWatch.connection, owner, pinnedRun, {
          protocolId: created.protocol.protocolId,
          version: 1,
        }, clock);
        assert.deepEqual(blocked, { error: "NOT_FROZEN" });
        assert.equal(writes(blockedWatch.captured, "run_protocol_pin").length, 0);
        assert.equal(await pinCount(), 0);
        assert.equal(await countBy(db, "run_protocol_pin", "run_id", bareRun), 0);

        const freezeOperation = randomUUID();
        const frozen = await freezeSamplingProtocol(db, owner, created.protocol.protocolId, {
          operationId: freezeOperation,
          ...fields,
        }, clock);
        assert.equal(frozen.protocol.status, "frozen");
        assert.equal(frozen.protocol.version, 1);
        assert.equal(frozen.protocol.id, created.protocol.id);
        const repeated = await freezeSamplingProtocol(db, owner, created.protocol.protocolId, {
          operationId: freezeOperation,
          ...fields,
        }, clock);
        assert.equal(repeated.protocol.version, 1);
        assert.equal(repeated.protocol.id, frozen.protocol.id);
        assert.equal(await protocolCount(), 1);
        const sameFields = await freezeSamplingProtocol(db, owner, created.protocol.protocolId, {
          operationId: randomUUID(),
          ...fields,
        }, clock);
        assert.equal(sameFields.protocol.id, frozen.protocol.id);
        assert.equal(await protocolCount(), 1);

        const conflict = await freezeSamplingProtocol(db, owner, created.protocol.protocolId, {
          operationId: freezeOperation,
          ...fields,
          timezone: nextTimezone,
        }, clock);
        assert.deepEqual(conflict, { error: "OPERATION_CONFLICT" });
        assert.equal(await protocolCount(), 1);

        const pinned = await pinSamplingProtocol(db, owner, pinnedRun, {
          protocolId: frozen.protocol.protocolId,
          version: 1,
        }, clock);
        assert.equal(pinned.pin.version, 1);
        assert.equal(pinned.pin.searchRequired, true);
        assert.equal(JSON.stringify(pinned.pin).includes("searchTriggered"), false);
        assert.deepEqual(await runSnapshot(db, pinnedRun), beforeRun);
        assert.equal(await countBy(db, "run_protocol_pin", "run_id", bareRun), 0);
        const pinnedAgain = await pinSamplingProtocol(db, owner, pinnedRun, {
          protocolId: frozen.protocol.protocolId,
          version: 1,
        }, clock);
        assert.equal(pinnedAgain.pin.version, 1);
        assert.equal(await pinCount(), 1);

        const [original] = await queryWithParameters(
          db,
          `SELECT id, version, status, target_region AS "targetRegion", timezone, search_required AS "searchRequired",
            new_session_required AS "newSessionRequired", operation_id AS "operationId"
            FROM sampling_protocol WHERE id = ?`,
          [frozen.protocol.id],
        );
        const revised = await freezeSamplingProtocol(db, owner, created.protocol.protocolId, {
          operationId: randomUUID(),
          ...fields,
          timezone: nextTimezone,
        }, clock);
        assert.equal(revised.protocol.version, 2);
        assert.equal((await dao.latestFrozenForBrand(owner, brand))?.id, revised.protocol.id);
        assert.equal(await dao.latestFrozenForBrand(outsider, brand), null);
        assert.equal(await dao.latestFrozenForBrand(owner, otherBrand), null);
        assert.notEqual(revised.protocol.id, frozen.protocol.id);
        assert.equal(await protocolCount(), 2);
        const [still] = await queryWithParameters(
          db,
          `SELECT id, version, status, target_region AS "targetRegion", timezone, search_required AS "searchRequired",
            new_session_required AS "newSessionRequired", operation_id AS "operationId"
            FROM sampling_protocol WHERE id = ?`,
          [frozen.protocol.id],
        );
        assert.deepEqual(still, original);
        const [keptPin] = await queryWithParameters(
          db,
          `SELECT protocol_id AS "protocolId", version FROM run_protocol_pin WHERE run_id = ?`,
          [pinnedRun],
        );
        assert.equal(keptPin.version, 1);
        assert.equal(keptPin.protocolId, frozen.protocol.protocolId);
        const moved = await pinSamplingProtocol(db, owner, pinnedRun, {
          protocolId: revised.protocol.protocolId,
          version: 2,
        }, clock);
        assert.deepEqual(moved, { error: "PIN_CONFLICT" });
        assert.equal(Number((await queryWithParameters(
          db,
          `SELECT version FROM run_protocol_pin WHERE run_id = ?`,
          [pinnedRun],
        ))[0].version), 1);

        const outsiderFreeze = await freezeSamplingProtocol(db, outsider, created.protocol.protocolId, {
          operationId: randomUUID(),
          ...fields,
        }, clock);
        assert.deepEqual(outsiderFreeze, { error: "NOT_FOUND" });
        const outsiderPin = await pinSamplingProtocol(db, outsider, pinnedRun, {
          protocolId: frozen.protocol.protocolId,
          version: 1,
        }, clock);
        assert.deepEqual(outsiderPin, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(outsiderPin).includes(timezone), false);
        const outsiderList = await listSamplingProtocols(db, outsider);
        assert.equal(outsiderList.protocols.some((protocol) => protocol.protocolId === created.protocol.protocolId), false);
        assert.equal(JSON.stringify(outsiderList).includes(timezone), false);
        assert.equal(JSON.stringify(outsiderList).includes(region), false);

        const listed = await listSamplingProtocols(db, owner);
        assert.equal(listed.protocols.filter((protocol) => protocol.protocolId === created.protocol.protocolId).length, 2);
        assert.equal(listed.pins.some((pin) => pin.runId === pinnedRun && pin.version === 1 && pin.searchRequired === true), true);
        const listWatch = watch(db);
        await listSamplingProtocols(listWatch.connection, owner);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "sampling_protocol")).length, 1);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "run_protocol_pin")).length, 1);

        await assert.rejects(
          () => db.transaction(async (tx) => {
            await new SamplingProtocolDao(tx).insertPin({
              runId: bareRun,
              brandId: brand,
              ownerId: owner,
              protocolId: frozen.protocol.protocolId,
              version: 1,
              createdAt: time,
            });
            throw new Error("rollback-fixture");
          }),
          /rollback-fixture/,
        );
        assert.equal(await countBy(db, "run_protocol_pin", "run_id", bareRun), 0);
        await assert.rejects(
          () => queryWithParameters(db, `UPDATE sampling_protocol SET status = 'available' WHERE id = ?`, [frozen.protocol.id]),
          /CHECK|check constraint/i,
        );

        const extraIds = Array.from({ length: 400 }, () => randomUUID());
        for (let offset = 0; offset < extraIds.length; offset += 100) {
          const chunk = extraIds.slice(offset, offset + 100);
          await queryWithParameters(
            db,
            `INSERT INTO sampling_protocol (
              id, protocol_id, brand_id, owner_id, version, new_session_required, search_required,
              target_region, timezone, status, fingerprint, operation_id, created_at
            ) VALUES ${chunk.map(() => "(?, ?, ?, ?, 1, 0, 0, 'ZZ', 'UTC', 'draft', ?, ?, ?)").join(", ")}`,
            chunk.flatMap((id) => [id, id, otherBrand, outsider, createHash("sha256").update(id).digest("hex"), id, time]),
          );
        }
        if (db.kind === "postgresql") await db.query("ANALYZE sampling_protocol");
        if (db.kind === "postgresql") await db.query("ANALYZE run_protocol_pin");
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const ownerQuery = samplingProtocolsForOwnerQuery(owner);
        const ownerPlan = JSON.stringify(await queryWithParameters(db, explain + ownerQuery.sql, ownerQuery.values));
        assert.match(ownerPlan, /sampling_protocol_owner_idx/);
        if (db.kind === "postgresql") assert.doesNotMatch(ownerPlan, /Seq Scan on sampling_protocol/);
        const readinessWatch = watch(db);
        await new SamplingProtocolDao(readinessWatch.connection).latestFrozenForBrand(owner, brand);
        assert.equal(readinessWatch.captured.length, 1);
        const readinessQuery = readinessWatch.captured[0];
        const readinessPlan = JSON.stringify(await queryWithParameters(db, explain + readinessQuery.sql, readinessQuery.values));
        assert.match(readinessPlan, /sampling_protocol_owner_idx/);
        const familyQuery = samplingProtocolFamilyQuery(owner, created.protocol.protocolId);
        const familyPlan = JSON.stringify(await queryWithParameters(db, explain + familyQuery.sql, familyQuery.values));
        assert.match(familyPlan, /sampling_protocol_(family_idx|version_key)/);
        const pinQuery = samplingProtocolPinsForOwnerQuery(owner);
        const pinPlan = JSON.stringify(await queryWithParameters(db, explain + pinQuery.sql, pinQuery.values));
        assert.match(pinPlan, /run_protocol_pin_owner_idx|run_protocol_pin/);
        assert.equal(await countBy(db, "run_protocol_pin", "run_id", bareRun), 0);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
