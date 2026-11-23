import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { initialBrandFields } from "../../src/features/brands/contracts.ts";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { reviewMedia } from "../../src/features/local-presence/media.ts";
import {
  listMediaReviews,
  readMediaReview,
  readMediaReviewsForBrand,
  recordMediaReview,
} from "../../src/features/local-presence/media-commands.ts";
import { approvedFactValue, mediaReviewErrors, recordMediaReviewSchema } from "../../src/features/local-presence/media-contracts.ts";
import { MediaReviewDao, mediaReviewsForBrandQuery, mediaReviewsForOwnerQuery } from "../../src/features/local-presence/media-dao.ts";
import { safeReturnTo } from "../../src/lib/auth/return-to.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { structure, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-23T08:00:00.000Z";
const shownWrong = "画面99";
const approvedPrice = "批准129";
const otherPrice = "对照88";

test("reviewMedia blocks a wrong price and refuses customer proof", () => {
  const blocked = reviewMedia({
    shownValue: shownWrong,
    approvedValue: approvedPrice,
    factVersion: 4,
    presentedAsCustomerProof: false,
  });
  assert.equal(blocked.deliver, false);
  assert.equal(blocked.reason, "fact_mismatch");
  assert.equal(blocked.factVersion, 4);
  const proof = reviewMedia({
    shownValue: approvedPrice,
    approvedValue: approvedPrice,
    factVersion: 4,
    presentedAsCustomerProof: true,
  });
  assert.equal(proof.deliver, false);
  assert.equal(proof.reason, "not_proof");
  const allowed = reviewMedia({
    shownValue: approvedPrice,
    approvedValue: approvedPrice,
    factVersion: 1,
    presentedAsCustomerProof: false,
  });
  assert.equal(allowed.deliver, true);
  assert.equal(allowed.reason, "ok");
  assert.equal(approvedFactValue(JSON.stringify({ claim: approvedPrice })), approvedPrice);
  assert.equal(approvedFactValue(approvedPrice), approvedPrice);
  assert.equal(approvedFactValue("{}"), null);
  const brandId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8192";
  const factId = "3160d7dc-1cae-4d26-8ce4-fd2b886c8193";
  const input = {
    brandId,
    kind: "image",
    shownValue: shownWrong,
    factVersionId: factId,
    presentedAsCustomerProof: false,
  };
  assert.equal(recordMediaReviewSchema.safeParse(input).success, true);
  assert.equal(recordMediaReviewSchema.safeParse({ ...input, approvedValue: approvedPrice }).success, false);
  assert.equal(recordMediaReviewSchema.safeParse({ ...input, deliver: true }).success, false);
  assert.equal(recordMediaReviewSchema.safeParse({ ...input, reason: "ok" }).success, false);
  assert.equal(recordMediaReviewSchema.safeParse({ ...input, kind: "video" }).success, false);
  assert.equal(mediaReviewErrors.NOT_FOUND, 404);
  assert.equal(safeReturnTo("/dashboard/content/media-reviews"), "/dashboard/content/media-reviews");
});

test("media check copy blocks a mismatch and does not call the check a publication", async () => {
  const zhCN = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/zh-CN.json", import.meta.url)));
  const en = JSON.parse(await readFile(new URL("../../src/lib/i18n/messages/en.json", import.meta.url)));
  assert.match(zhCN.mediaReviews.description, /阻断交付/);
  assert.match(zhCN.mediaReviews.description, /不会生成交付包/);
  assert.match(zhCN.mediaReviews.deliverBlocked, /阻断交付/);
  assert.match(zhCN.mediaReviews.reasonFactMismatch, /不一致/);
  assert.match(zhCN.mediaReviews.reasonNotProof, /客户证明/);
  assert.match(zhCN.mediaReviews.shownLine, /画面或脚本文字 \{value\}/);
  assert.match(zhCN.mediaReviews.factLine, /事实版本 \{id\}/);
  assert.equal(JSON.stringify(zhCN.mediaReviews).includes(shownWrong), false);
  assert.equal(JSON.stringify(zhCN.mediaReviews).includes(approvedPrice), false);
  assert.match(en.mediaReviews.description, /blocks delivery/i);
  assert.match(en.mediaReviews.description, /does not create a delivery package/i);
  assert.match(en.mediaReviews.deliverBlocked, /blocked/i);
  assert.match(en.mediaReviews.reasonFactMismatch, /approved fact/i);
  assert.match(en.mediaReviews.reasonNotProof, /customer proof/i);
  assert.match(en.mediaReviews.shownLine, /Shown text \{value\}/);
  assert.match(en.mediaReviews.factLine, /Fact version \{id\}/);
  assert.equal(JSON.stringify(en.mediaReviews).includes(shownWrong), false);
  assert.equal(JSON.stringify(en.mediaReviews).includes(approvedPrice), false);
  assert.equal(zhCN.content.mediaReviewsLink.length > 0, true);
  assert.equal(en.content.mediaReviewsLink.length > 0, true);
  const page = await readFile(new URL("../../src/features/local-presence/media-page.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../../src/features/local-presence/media-panel.tsx", import.meta.url), "utf8");
  const source = await readFile(new URL("../../src/features/local-presence/media-commands.ts", import.meta.url), "utf8");
  assert.equal(page.includes("description") && page.includes("fixtureNote"), true);
  assert.equal(panel.includes("shownLine") && panel.includes("approvedLine") && panel.includes("factLine"), true);
  assert.equal(panel.includes("deliverBlocked") && panel.includes("deliverAllowed"), true);
  assert.equal(panel.includes(shownWrong), false);
  assert.equal(panel.includes(approvedPrice), false);
  assert.equal(source.includes("reviewMedia"), true);
  assert.equal(source.includes("content_delivery_package"), false);
  assert.equal(source.includes("content_publication"), false);
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
    [id, "Media reviewer", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function countRows(db, table, brandId) {
  const [row] = await queryWithParameters(
    db,
    `SELECT count(*) AS "total" FROM ${table} WHERE brand_id = ?`,
    [brandId],
  );
  return Number(row.total);
}

async function approvedFact(db, brandId, ownerId, claim) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    `INSERT INTO brand_fact_version
      (brand_id, id, fact_id, version, entity_version, paste_id, revision, state, content, created_at, confirmed_by, confirmed_at, revoked_at)
     VALUES (?, ?, ?, 1, 1, NULL, 1, 'approved', ?, ?, ?, ?, NULL)`,
    [brandId, id, id, JSON.stringify({ claim }), time, ownerId, time],
  );
  return id;
}

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: a media check blocks a wrong fact and customer proof without a delivery package`, async () => {
    const fixture = await testDatabase(kind);
    try {
      const ddl = await testDatabase(kind, { ddl: true });
      try {
        const db = fixture.connection;
        const migrated = await structure(db);
        assert.deepEqual(migrated, await structure(ddl.connection));
        const defined = JSON.stringify(migrated);
        assert.match(defined, /media_review_owner_idx/);
        assert.match(defined, /media_review_owner_brand_idx/);
        assert.match(defined, /media_review_state_check/);
        if (db.kind === "postgresql") {
          assert.match(defined, /media_review_fact_fk/);
          assert.match(defined, /media_review_brand_id_brand_id_fk/);
          assert.match(defined, /media_review_owner_id_user_id_fk/);
        } else {
          assert.match(defined, /FOREIGN KEY \(`brand_id`,`fact_version_id`\) REFERENCES `brand_fact_version`/);
        }
        const columns = tableSql(migrated, "media_review");
        for (const word of ["password", "token", "secret", "cookie", "published", "package", "ranking", "user_agent"]) {
          assert.equal(columns.includes(word), false, word);
        }
        assert.equal(columns.includes("shown_value"), true);
        assert.equal(columns.includes("approved_value"), true);
        assert.equal(columns.includes("fact_version_id"), true);
        assert.equal(columns.includes("deliver"), true);

        const [owner, outsider] = await Promise.all([account(db), account(db)]);
        const brand = randomUUID();
        const otherBrand = randomUUID();
        const brands = new BrandDao(db);
        await brands.insertBrand(owner, brand, time);
        await brands.insertBrand(outsider, otherBrand, time);
        await brands.insertVersion(brand, 1, {
          ...initialBrandFields,
          name: "合成图文品牌",
          description: "合成品牌资料，仅用于图文核对",
        }, time);
        await brands.insertVersion(otherBrand, 1, {
          ...initialBrandFields,
          name: "合成对照品牌",
          description: "合成品牌资料，仅用于隔离核对",
        }, time);
        const factId = await approvedFact(db, brand, owner, approvedPrice);
        const otherFactId = await approvedFact(db, otherBrand, outsider, otherPrice);
        const draftId = randomUUID();
        await queryWithParameters(
          db,
          `INSERT INTO brand_fact_version
            (brand_id, id, fact_id, version, entity_version, paste_id, revision, state, content, created_at, confirmed_by, confirmed_at, revoked_at)
           VALUES (?, ?, ?, 1, 1, NULL, 1, 'draft', ?, ?, NULL, NULL, NULL)`,
          [brand, draftId, draftId, JSON.stringify({ claim: approvedPrice }), time],
        );
        const clock = clockFrom(time);
        const packages = () => countRows(db, "content_delivery_package", brand);
        const publications = () => countRows(db, "content_publication", brand);
        assert.equal(await packages(), 0);
        assert.equal(await publications(), 0);

        const hiddenWatch = watch(db);
        const hidden = await recordMediaReview(hiddenWatch.connection, outsider, {
          brandId: brand,
          kind: "image",
          shownValue: shownWrong,
          factVersionId: factId,
          presentedAsCustomerProof: false,
        }, clock);
        assert.deepEqual(hidden, { error: "NOT_FOUND" });
        assert.equal(writes(hiddenWatch.captured).length, 0);
        assert.equal(JSON.stringify(hidden).includes(shownWrong), false);
        assert.equal(JSON.stringify(hidden).includes(approvedPrice), false);

        const foreignFact = await recordMediaReview(db, owner, {
          brandId: brand,
          kind: "image",
          shownValue: shownWrong,
          factVersionId: otherFactId,
          presentedAsCustomerProof: false,
        }, clock);
        assert.deepEqual(foreignFact, { error: "NOT_FOUND" });
        const draft = await recordMediaReview(db, owner, {
          brandId: brand,
          kind: "image",
          shownValue: shownWrong,
          factVersionId: draftId,
          presentedAsCustomerProof: false,
        }, clock);
        assert.deepEqual(draft, { error: "NOT_FOUND" });
        assert.equal(await countRows(db, "media_review", brand), 0);

        const mismatchWatch = watch(db);
        const mismatch = await recordMediaReview(mismatchWatch.connection, owner, {
          brandId: brand,
          kind: "image",
          shownValue: shownWrong,
          factVersionId: factId,
          presentedAsCustomerProof: false,
        }, clock);
        const expectedMismatch = reviewMedia({
          shownValue: shownWrong,
          approvedValue: approvedPrice,
          factVersion: 1,
          presentedAsCustomerProof: false,
        });
        assert.equal(mismatch.review.deliver, expectedMismatch.deliver);
        assert.equal(mismatch.review.reason, "fact_mismatch");
        assert.equal(mismatch.review.factVersionId, factId);
        assert.equal(mismatch.review.shownValue, shownWrong);
        assert.equal(mismatch.review.approvedValue, approvedPrice);
        assert.equal(mismatch.review.kind, "image");
        assert.equal(writes(mismatchWatch.captured).length, 1);
        assert.match(writes(mismatchWatch.captured)[0].sql, /insert into media_review/i);
        assert.equal(/content_delivery_package|content_publication/i.test(writes(mismatchWatch.captured)[0].sql), false);

        const proof = await recordMediaReview(db, owner, {
          brandId: brand,
          kind: "script",
          shownValue: approvedPrice,
          factVersionId: factId,
          presentedAsCustomerProof: true,
        }, clock);
        assert.equal(proof.review.deliver, false);
        assert.equal(proof.review.reason, "not_proof");
        assert.equal(proof.review.factVersionId, factId);
        assert.equal(proof.review.kind, "script");

        const allowed = await recordMediaReview(db, owner, {
          brandId: brand,
          kind: "image",
          shownValue: approvedPrice,
          factVersionId: factId,
          presentedAsCustomerProof: false,
        }, clock);
        assert.equal(allowed.review.deliver, true);
        assert.equal(allowed.review.reason, "ok");
        assert.equal(allowed.review.factVersionId, factId);
        assert.equal(await packages(), 0);
        assert.equal(await publications(), 0);
        const [stored] = await queryWithParameters(
          db,
          `SELECT deliver, reason, fact_version_id AS "factVersionId" FROM media_review WHERE id = ?`,
          [allowed.review.id],
        );
        assert.equal(Number(stored.deliver), 1);
        assert.equal(stored.reason, "ok");
        assert.equal(stored.factVersionId, factId);

        const outsiderRead = await readMediaReview(db, outsider, mismatch.review.id);
        assert.deepEqual(outsiderRead, { error: "NOT_FOUND" });
        assert.equal(JSON.stringify(outsiderRead).includes(shownWrong), false);
        const outsiderList = await listMediaReviews(db, outsider);
        assert.equal(outsiderList.reviews.some((row) => row.factVersionId === factId), false);
        assert.equal(JSON.stringify(outsiderList).includes(shownWrong), false);
        assert.equal(JSON.stringify(outsiderList).includes(approvedPrice), false);

        const visible = await readMediaReview(db, owner, mismatch.review.id);
        assert.equal(visible.review.shownValue, shownWrong);
        assert.equal(visible.review.factVersionId, factId);
        assert.equal(visible.review.deliver, false);
        const forBrand = await readMediaReviewsForBrand(db, owner, brand);
        assert.equal(forBrand.reviews.some((row) => row.id === mismatch.review.id && row.reason === "fact_mismatch"), true);
        assert.equal(forBrand.facts.some((row) => row.id === factId && row.approvedValue === approvedPrice), true);

        const listWatch = watch(db);
        const listed = await listMediaReviews(listWatch.connection, owner);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "media_review")).length, 1);
        assert.equal(listWatch.captured.filter((item) => isSelect(item.sql, "brand_fact_version")).length, 1);
        assert.equal(listed.reviews.filter((row) => row.brandId === brand).length, 3);
        assert.equal(listed.reviews.some((row) => row.reason === "fact_mismatch" && row.factVersionId === factId), true);

        const rolled = randomUUID();
        await assert.rejects(
          () => db.transaction(async (tx) => {
            await new MediaReviewDao(tx).insertReview({
              id: rolled,
              brandId: brand,
              ownerId: owner,
              kind: "image",
              shownValue: approvedPrice,
              approvedValue: approvedPrice,
              factVersionId: factId,
              reason: "ok",
              deliver: 1,
              recordedAt: time,
            });
            throw new Error("rollback-fixture");
          }),
          /rollback-fixture/,
        );
        assert.deepEqual(await readMediaReview(db, owner, rolled), { error: "NOT_FOUND" });

        await assert.rejects(
          () => queryWithParameters(db, `UPDATE media_review SET deliver = 1, reason = 'ok' WHERE id = ?`, [mismatch.review.id]),
          /CHECK|check constraint/i,
        );

        const extra = Array.from({ length: 400 }, () => randomUUID());
        for (let offset = 0; offset < extra.length; offset += 100) {
          const chunk = extra.slice(offset, offset + 100);
          await queryWithParameters(
            db,
            `INSERT INTO media_review (
              id, brand_id, owner_id, kind, shown_value, approved_value, fact_version_id, reason, deliver, recorded_at
            ) VALUES ${chunk.map(() => "(?, ?, ?, 'image', ?, ?, ?, 'ok', 1, ?)").join(", ")}`,
            chunk.flatMap((id) => [id, otherBrand, outsider, otherPrice, otherPrice, otherFactId, time]),
          );
        }
        if (db.kind === "postgresql") await db.query("ANALYZE media_review");
        const explain = db.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
        const ownerQuery = mediaReviewsForOwnerQuery(owner);
        const ownerPlan = JSON.stringify(await queryWithParameters(db, explain + ownerQuery.sql, ownerQuery.values));
        assert.match(ownerPlan, /media_review_owner(?:_brand)?_idx/);
        if (db.kind === "postgresql") assert.doesNotMatch(ownerPlan, /Seq Scan on media_review/);
        const brandQuery = mediaReviewsForBrandQuery(owner, brand);
        const brandPlan = JSON.stringify(await queryWithParameters(db, explain + brandQuery.sql, brandQuery.values));
        assert.match(brandPlan, /media_review_owner_brand_idx/);
        assert.equal(await packages(), 0);
        assert.equal(await publications(), 0);
      } finally {
        await ddl.cleanup();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}
