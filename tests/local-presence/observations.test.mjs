import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { listLocalObservations, readLocalObservation, registerLocalObservation } from "../../src/features/local-presence/commands.ts";
import { localObservationErrors, registerLocalObservationSchema, unknownSampledPlace } from "../../src/features/local-presence/contracts.ts";
import { LocalObservationDao, localObservationsForOwnerQuery } from "../../src/features/local-presence/dao.ts";
import { localObservation } from "../../src/features/local-presence/rules.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
const rankingClaim = /杭州用户真实排名|Hangzhou users?' real ranking/i;

test("localObservation keeps an unknown sample separate from the target city", () => {
  const row = localObservation({ targetCity: "杭州", sampledCity: null });
  assert.equal(row.targetCity, "杭州");
  assert.equal(row.sampledCity, null);
  assert.equal(row.ranked, false);
  assert.equal(row.claimedLocalUsers, false);
  const input = { brandId, targetCity: "杭州" };
  assert.equal(registerLocalObservationSchema.safeParse(input).success, true);
  assert.equal(registerLocalObservationSchema.safeParse({ ...input, sampledCity: null }).success, true);
  assert.equal(registerLocalObservationSchema.safeParse({ ...input, ranked: true }).success, false);
  assert.equal(registerLocalObservationSchema.safeParse({ ...input, claimedLocalUsers: true }).success, false);
  assert.equal(registerLocalObservationSchema.safeParse({ ...input, ranking: "1" }).success, false);
  assert.equal(localObservationErrors.INVALID_INPUT, 400);
  assert.equal(localObservationErrors.NOT_FOUND, 404);
  assert.equal(safeReturnTo("/dashboard/brands/local-observations"), "/dashboard/brands/local-observations");
});

test("local observation copy shows both places and does not translate the city", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.localObservations.description, /目标城市/);
  assert.match(zhCN.localObservations.description, /未知/);
  assert.equal(zhCN.localObservations.unknownPlace, "未知");
  assert.match(zhCN.localObservations.targetLine, /目标城市 \{city\}/);
  assert.match(zhCN.localObservations.actualLine, /实际采样位置 \{place\}/);
  assert.equal(rankingClaim.test(JSON.stringify(zhCN.localObservations)), false);
  assert.equal(JSON.stringify(zhCN.localObservations).includes("杭州"), false);
  assert.match(en.localObservations.description, /target city/i);
  assert.match(en.localObservations.description, /unknown/i);
  assert.equal(en.localObservations.unknownPlace, "Unknown");
  assert.match(en.localObservations.targetLine, /Target city \{city\}/);
  assert.match(en.localObservations.actualLine, /Sampled place \{place\}/);
  assert.equal(rankingClaim.test(JSON.stringify(en.localObservations)), false);
  assert.equal(JSON.stringify(en.localObservations).includes("杭州"), false);
  assert.equal(JSON.stringify(en.localObservations).includes("Hangzhou"), false);
  assert.equal(zhCN.brands.openLocalObservations.length > 0, true);
  assert.equal(en.brands.openLocalObservations.length > 0, true);
  const page = await readFile(new URL("../../src/features/local-presence/page.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../../src/features/local-presence/panel.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("description") && page.includes("fixtureNote"), true);
  assert.equal(panel.includes("targetLine") && panel.includes("actualLine") && panel.includes("unknownPlace"), true);
  assert.equal(panel.includes("observation.targetCity"), true);
  assert.equal(panel.includes("杭州"), false);
  const source = await readFile(new URL("../../src/features/local-presence/commands.ts", import.meta.url), "utf8");
  assert.equal(source.includes("localObservation"), true);
  assert.equal(/\bfetch\s*\(|\bundici\b|net\.request|https?:\/\//.test(source), false);
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

function writes(captured) {
  return captured.filter((item) => /^\s*(insert|update|delete)/i.test(item.sql));
}

function storedColumns(shape) {
  if (Array.isArray(shape)) {
    return shape
      .filter((row) => row.tbl_name === "local_observation")
      .map((row) => row.sql ?? "")
      .join("\n")
      .toLowerCase();
  }
  return shape.columns
    .filter((row) => row.table_name === "local_observation")
    .map((row) => row.column_name)
    .join(",")
    .toLowerCase();
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Local observation owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

function observation(brand, overrides = {}) {
  return {
    brandId: brand,
    targetCity: "杭州",
    sampledCity: null,
    ...overrides,
  };
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: an unknown sampled place stays unranked and hidden from another user`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        assert.match(defined, /local_observation_owner_idx/);
        assert.match(defined, /local_observation_state_check/);
        if (db.kind === "postgresql") assert.match(defined, /local_observation_brand_id_brand_id_fk/);
        else assert.match(defined, /FOREIGN KEY \(`brand_id`\) REFERENCES `brand`/);
        const columns = storedColumns(migrated);
        for (const word of ["latitude", "longitude", "ranking", "password", "token", "secret", "cookie", "user_agent"]) {
          assert.equal(columns.includes(word), false, word);
        }
        assert.equal(columns.includes("target_city"), true);
        assert.equal(columns.includes("sampled_city"), true);
        assert.equal(columns.includes("ranked"), true);
        assert.equal(columns.includes("claimed_local_users"), true);

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        const clock = clockFrom(time);

        const hiddenWatch = watch(db);
        const hidden = await registerLocalObservation(hiddenWatch.connection, outsider, observation(brand), clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(writes(hiddenWatch.captured).length, 0);
        assert.equal(JSON.stringify(hidden).includes("杭州"), false);

        const unknown = await registerLocalObservation(db, owner, observation(brand), clock);
        assert.equal(unknown.observation.targetCity, "杭州");
        assert.equal(unknown.observation.sampledCity, null);
        assert.equal(unknown.observation.actualStatus, unknownSampledPlace);
        assert.equal(unknown.observation.ranked, false);
        assert.equal(unknown.observation.claimedLocalUsers, false);
        assert.equal(rankingClaim.test(JSON.stringify(unknown)), false);

        const separate = await registerLocalObservation(db, owner, observation(brand, { sampledCity: "宁波" }), clock);
        assert.equal(separate.observation.targetCity, "杭州");
        assert.equal(separate.observation.sampledCity, "宁波");
        assert.equal(separate.observation.actualStatus, "sampled");
        assert.equal(separate.observation.ranked, false);

        const stored = await queryWithParameters(
          db,
          `SELECT target_city AS "targetCity", sampled_city AS "sampledCity", ranked, claimed_local_users AS "claimedLocalUsers"
            FROM local_observation WHERE id = ?`,
          [unknown.observation.id],
        );
        assert.equal(stored[0].targetCity, "杭州");
        assert.equal(stored[0].sampledCity, null);
        assert.equal(Number(stored[0].ranked), 0);
        assert.equal(Number(stored[0].claimedLocalUsers), 0);

        const hiddenRead = await readLocalObservation(db, outsider, unknown.observation.id);
        assert.deepEqual(hiddenRead, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(hiddenRead).includes("杭州"), false);
        const hiddenList = await listLocalObservations(db, outsider);
        assert.equal(hiddenList.observations.some((row) => row.id === unknown.observation.id), false);
        const visible = await readLocalObservation(db, owner, unknown.observation.id);
        assert.equal(visible.observation.targetCity, "杭州");
        assert.equal(visible.observation.actualStatus, "unknown");
        assert.equal(visible.observation.ranked, false);

        const listWatch = watch(db);
        const listed = await listLocalObservations(listWatch.connection, owner);
        const observationSelects = listWatch.captured.filter((item) => isSelect(item.sql, "local_observation"));
        assert.equal(observationSelects.length, 1);
        assert.equal(listed.observations.some((row) => row.actualStatus === "unknown" && row.targetCity === "杭州"), true);
        assert.equal(listed.observations.some((row) => row.sampledCity === "宁波"), true);

        const rolled = randomUUID();
        await assert.rejects(
          () => db.transaction(async (tx) => {
            await new LocalObservationDao(tx).insertObservations([{
              id: rolled,
              brandId: brand,
              ownerId: owner,
              targetCity: "杭州",
              sampledCity: null,
              ranked: 0,
              claimedLocalUsers: 0,
              recordedAt: time,
            }]);
            throw new Error("rollback-fixture");
          }),
          /rollback-fixture/,
        );
        assert.deepEqual(await readLocalObservation(db, owner, rolled), { error: "NOT_FOUND" });

        const extra = Array.from({ length: 3000 }, () => randomUUID());
        await queryWithParameters(
          db,
          `INSERT INTO local_observation (
            id, brand_id, owner_id, target_city, sampled_city, ranked, claimed_local_users, recorded_at
          ) VALUES ${extra.map(() => "(?, ?, ?, '杭州', NULL, 0, 0, ?)").join(", ")}`,
          extra.flatMap((id) => [id, otherBrand, outsider, time]),
        );
        if (db.kind === "postgresql") await db.query("ANALYZE local_observation");
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const ownerQuery = localObservationsForOwnerQuery(owner);
        const ownerPlan = JSON.stringify(await queryWithParameters(db, explain + ownerQuery.sql, ownerQuery.values));
        assert.match(ownerPlan, /local_observation_owner_idx/);
        if (db.kind === "postgresql") assert.doesNotMatch(ownerPlan, /Seq Scan on local_observation/);

        await assert.rejects(
          () => queryWithParameters(db, `UPDATE local_observation SET ranked = 1 WHERE id = ?`, [unknown.observation.id]),
          /CHECK|check constraint/i,
        );
        await assert.rejects(
          () => queryWithParameters(db, `UPDATE local_observation SET claimed_local_users = 1 WHERE id = ?`, [unknown.observation.id]),
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
