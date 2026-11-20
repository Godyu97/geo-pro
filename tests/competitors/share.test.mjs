import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { PurgeDao } from "../../src/features/brands/purge-dao.ts";
import {
  readCompetitorShare,
  recordCompetitorMentions,
  saveCompetitorSet,
  shareFromMentions,
} from "../../src/features/competitors/commands.ts";
import { submitManualEvidence } from "../../src/features/evidence/commands.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-20T10:00:00.000Z";
const clock = () => time;
const fields = {
  name: "乙品牌",
  description: "Synthetic brand for competitor share",
  website: "https://yi.example.com",
  aliases: ["乙"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

function previousTag(kind) {
  const journal = JSON.parse(readFileSync(
    kind === "sqlite" ? "drizzle/sqlite/meta/_journal.json" : "drizzle/meta/_journal.json",
    "utf8",
  ));
  return journal.entries.at(-2).tag;
}

async function account(db) {
  const id = randomUUID();
  await queryWithParameters(
    db,
    'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)',
    [id, "Competitor owner", `${id}@example.invalid`, db.kind === "sqlite" ? 1 : true],
  );
  return id;
}

async function observation(db, owner, brand, text) {
  const saved = await submitManualEvidence(db, owner, {
    action: "submit-manual",
    brandId: brand,
    operationId: randomUUID(),
    questionText: "这个品类里该怎么选？",
    answerText: text,
    region: "CN",
    language: "zh-CN",
    requestedNetworkMode: "unknown",
    entityVersion: 1,
    citationSetState: "complete",
    citations: [],
    locatorRef: `fixture://competitors/${randomUUID()}`,
    collectorId: owner,
    contested: false,
    brandName: "乙品牌",
    aliases: ["乙"],
    officialWebsite: "https://yi.example.com",
    mentioned: "true",
    recommended: "unknown",
    officialSiteCited: "unknown",
  }, clock);
  assert.equal(saved.error, undefined);
  return saved.observation.id;
}

test("repeated mentions in one answer count once and unordered output has no rank", () => {
  const share = shareFromMentions(["甲", "乙"], [
    { observationId: "a1", competitorLabel: "甲", ordered: 0, position: null },
    { observationId: "a1", competitorLabel: "甲", ordered: 0, position: null },
    { observationId: "a1", competitorLabel: "乙", ordered: 0, position: null },
  ]);
  assert.equal(share.rows.find((row) => row.brandId === "甲")?.count, 1);
  assert.equal(share.rows[0].denominator, 1);
  assert.equal(share.rank.ranked, false);
  assert.equal(share.rank.mean, null);
});

test("an absent competitor is left out of the conditional mean", () => {
  const share = shareFromMentions(["甲", "乙"], [
    { observationId: "a1", competitorLabel: "甲", ordered: 1, position: 1 },
  ]);
  assert.equal(share.rank.ranked, true);
  assert.equal(share.rank.mean, 1);
  assert.deepEqual(share.rank.excludedAbsent, ["乙"]);
  assert.equal(share.rows.find((row) => row.brandId === "乙")?.share, 0);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: fixed set counts once per answer and a new set does not pool old mentions`, async (t) => {
    if (kind === "postgresql" && !process.env.DATABASE_URL) {
      t.skip("local PostgreSQL URL is not configured");
      return;
    }
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const db = fixture.connection;
    await migrateThrough(db, previousTag(kind));
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const [owner, outsider] = await Promise.all([account(db), account(db)]);
    const brand = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brand, time);
    await brands.insertVersion(brand, 1, fields, time);
    const firstAnswer = await observation(db, owner, brand, "回答同时写了甲和甲，也写了乙。");
    const secondAnswer = await observation(db, owner, brand, "另一条回答只写了甲。");

    const saved = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["乙", "甲", "甲"] }, clock);
    assert.equal(saved.error, undefined);
    assert.equal(saved.created, true);
    assert.deepEqual(saved.set.labels, ["乙", "甲"]);
    const replay = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["甲", "乙"] }, clock);
    assert.equal(replay.created, false);
    assert.equal(replay.set.id, saved.set.id);

    const recorded = await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: saved.set.id,
      observationId: firstAnswer,
      ordered: false,
      mentions: [{ label: "甲" }, { label: "乙" }],
    }, clock);
    assert.equal(recorded.error, undefined);
    const again = await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: saved.set.id,
      observationId: firstAnswer,
      ordered: false,
      mentions: [{ label: "甲" }],
    }, clock);
    assert.equal(again.error, undefined);
    const conflict = await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: saved.set.id,
      observationId: firstAnswer,
      ordered: true,
      mentions: [{ label: "甲", position: 1 }],
    }, clock);
    assert.equal(conflict.error, "OPERATION_CONFLICT");

    await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: saved.set.id,
      observationId: secondAnswer,
      ordered: false,
      mentions: [{ label: "甲" }],
    }, clock);

    const share = await readCompetitorShare(db, owner, brand);
    assert.equal(share.error, undefined);
    assert.equal(share.rows.find((row) => row.brandId === "甲")?.count, 2);
    assert.equal(share.rows.find((row) => row.brandId === "乙")?.count, 1);
    assert.equal(share.rows[0].denominator, 2);
    assert.equal(share.rank.ranked, false);

    const outside = await recordCompetitorMentions(db, owner, {
      brandId: brand,
      setId: saved.set.id,
      observationId: secondAnswer,
      ordered: false,
      mentions: [{ label: "丙" }],
    }, clock);
    assert.equal(outside.error, "INVALID_INPUT");

    const next = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["甲", "丙"] }, clock);
    assert.equal(next.created, true);
    assert.equal(next.set.version, 2);
    const pooled = await readCompetitorShare(db, owner, brand, 1);
    assert.equal(pooled.rows.find((row) => row.brandId === "甲")?.count, 2);
    const fresh = await readCompetitorShare(db, owner, brand, 2);
    assert.equal(fresh.rows.find((row) => row.brandId === "甲")?.count, 0);
    assert.equal(fresh.rows.find((row) => row.brandId === "丙")?.share, null);

    const denied = await readCompetitorShare(db, outsider, brand);
    assert.equal(denied.error, "NOT_FOUND");
    await queryWithParameters(db, "UPDATE brand SET frozen_at = ? WHERE id = ?", [time, brand]);
    const frozen = await saveCompetitorSet(db, owner, { brandId: brand, labels: ["甲"] }, clock);
    assert.equal(frozen.error, "NOT_FOUND");
    await queryWithParameters(db, "UPDATE brand SET frozen_at = NULL WHERE id = ?", [brand]);

    await new PurgeDao(db).clearContents({ ownerId: owner, brandId: brand }, time);
    const left = await queryWithParameters(db, "SELECT id FROM competitor_set WHERE brand_id = ?", [brand]);
    assert.equal(left.length, 0);
  });
}
