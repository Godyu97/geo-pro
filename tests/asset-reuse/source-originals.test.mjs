import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifySourceImport } from "../../src/features/asset-reuse/classify.ts";
import {
  importSourceOriginals,
  listImportedOriginals,
  presignSourceOriginal,
  readSourceOriginal,
  setSourceOriginalRights,
} from "../../src/features/asset-reuse/commands.ts";
import { fragmentCandidates, importBatch, pagesFromText, sourceImportLimits } from "../../src/features/asset-reuse/rules.ts";
import { saveApprovalPolicy, decideApproval } from "../../src/features/approval-policy/commands.ts";
import { executeFactCommand, readFactWorkspace, withEligibleFacts } from "../../src/features/brand-facts/service.ts";
import { listApprovedBriefFacts } from "../../src/features/content/commands.ts";
import { structure } from "../maintenance/helpers.mjs";
import { BrandDao } from "../../src/features/brands/dao.ts";
import { queryWithParameters } from "../../src/lib/db/connection.ts";
import { migrateThrough, testDatabase } from "../maintenance/helpers.mjs";

const time = "2026-11-21T08:00:00.000Z";
const now = new Date(time);
const body = Uint8Array.from([0x6f, 0x6b]);
const storageEnv = {
  S3_ENDPOINT: "http://127.0.0.1:9",
  S3_ENDPOINT_BROWSER: "http://192.0.2.10:8333",
  S3_REGION: "us-east-1",
  S3_BUCKET: "app-files",
  S3_ACCESS_KEY_ID: "local-app",
  S3_SECRET_ACCESS_KEY: "s3-secret-not-for-logs",
  S3_FORCE_PATH_STYLE: "true",
};
const brandFields = {
  name: "己品牌",
  description: "Synthetic brand for source originals",
  website: "https://ji.example.com",
  aliases: ["己"],
  region: "CN",
  language: "zh-CN",
  competitors: [],
  questions: [],
};

function file(name, extra = {}) {
  return {
    name,
    contentType: "text/plain",
    chars: 2,
    encrypted: false,
    pages: [{ page: 1, text: "ok" }],
    body,
    ...extra,
  };
}

function memoryStorage() {
  const objects = new Map();
  const calls = { put: 0, get: 0, presign: 0 };
  return {
    calls,
    async putAndReadBack({ key, body: bytes, contentType }) {
      calls.put += 1;
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      objects.set(key, bytes);
      return { ok: true, status: "ready", bucket: "app-files", key, byteSize: bytes.byteLength, sha256, contentType };
    },
    async getObject({ key }) {
      calls.get += 1;
      const stored = objects.get(key);
      if (!stored) return { ok: false, status: "failed", code: "unavailable" };
      return { ok: true, body: stored, byteSize: stored.byteLength, sha256: createHash("sha256").update(stored).digest("hex") };
    },
    async deleteObject() {
      return { ok: true };
    },
    async presignGet({ key }) {
      calls.presign += 1;
      return { ok: true, url: `http://192.0.2.10:8333/app-files/${key}?X-Amz-Expires=900`, expiresInSeconds: 900 };
    },
  };
}

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

async function explain(connection, sql, values) {
  const prefix = connection.kind === "postgresql" ? "EXPLAIN (COSTS OFF) " : "EXPLAIN QUERY PLAN ";
  if (connection.kind === "postgresql") {
    await connection.query("ANALYZE source_original");
    return connection.transaction(async (tx) => {
      await tx.query("SET LOCAL enable_seqscan = off");
      return queryWithParameters(tx, prefix + sql, values);
    });
  }
  return queryWithParameters(connection, prefix + sql, values);
}

test("messages: source import results exist in zh-CN and en", () => {
  const zhCN = JSON.parse(readFileSync("src/lib/i18n/messages/zh-CN.json", "utf8"));
  const en = JSON.parse(readFileSync("src/lib/i18n/messages/en.json", "utf8"));
  for (const key of ["reasonEncrypted", "reasonOversized", "reasonUnrecognized", "reasonBatchLimit", "rightsRevoked", "rightsExpired", "statusPartial", "notApproved", "fragmentMissing", "fragmentUnreadable", "fragmentNoConflict"]) {
    assert.match(zhCN.sources[key], /加密|10 MB|识别|10 个|撤销|到期|页码|批准|读取/);
    assert.match(en.sources[key], /encrypted|10 MB|recognized|10 files|revoked|expired|page number|approved|read/);
    assert.equal(zhCN.sources[key].includes("127.0.0.1"), false);
    assert.equal(en.sources[key].includes("v1/"), false);
  }
});

test("pure: retained files stay unapproved and rejected files are not writable", () => {
  const classified = classifySourceImport([
    file("kept.txt"),
    file("huge.txt", { chars: sourceImportLimits.maxChars + 1 }),
    file("locked.pdf", { contentType: "application/pdf", encrypted: true, pages: [] }),
    file("run.bin", { contentType: "application/octet-stream" }),
    file("scan.md", { contentType: "text/markdown", pages: [{ page: 1, text: "ok" }, { page: null, text: null }] }),
  ]);
  assert.equal(classified.factsApproved, false);
  assert.deepEqual(classified.files.map((item) => [item.fileName, item.status, item.reason, item.write]), [
    ["kept.txt", "ready", null, true],
    ["huge.txt", "failed", "oversized", false],
    ["locked.pdf", "failed", "encrypted", false],
    ["run.bin", "failed", "unrecognized", false],
    ["scan.md", "partial", null, true],
  ]);
});

test("pure: a two-page text keeps page 1 and does not invent the missing page", () => {
  const pages = pagesFromText("北岸保修两年\f");
  assert.deepEqual(pages, [
    { page: 1, text: "北岸保修两年" },
    { page: 2, text: null },
  ]);
  assert.deepEqual(pagesFromText("只有正文"), [{ page: null, text: "只有正文" }]);
  const imported = importBatch([{ name: "two.txt", bytes: 20, chars: 20, encrypted: false, pages }]);
  assert.equal(imported[0].status, "partial");
  assert.equal(imported[0].pages[1].text, null);
  assert.equal(imported[0].pages[1].page, 2);
  const kept = importBatch([{
    name: "body.txt", bytes: 8, chars: 8, encrypted: false, pages: [{ page: null, text: "保留正文" }],
  }]);
  assert.equal(kept[0].status, "partial");
  assert.equal(kept[0].pages[0].text, "保留正文");
  assert.equal(kept[0].pages[0].page, null);
  const judged = fragmentCandidates(pages, [
    { id: "11111111-1111-4111-8111-111111111111", version: 2, claim: "保修一年" },
    { id: "22222222-2222-4222-8222-222222222222", version: 4, claim: "北岸保修两年" },
  ]);
  assert.equal(judged[0].approved, false);
  assert.deepEqual(judged[0].conflicts, [{ factVersionId: "11111111-1111-4111-8111-111111111111", version: 2 }]);
  assert.equal(judged[1].text, null);
  assert.deepEqual(judged[1].conflicts, []);
  assert.equal(judged[1].approved, false);
});

for (const kind of ["sqlite", "postgresql"]) {
  test(`${kind}: source originals keep ready objects, stop downloads after rights change, and hide bytes`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    t.after(() => fixture.cleanup());
    const baseline = kind === "sqlite" ? "0027_real_fallen_one" : "0028_new_patch";
    await migrateThrough(fixture.connection, baseline);
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const db = fixture.connection;
    const owner = randomUUID();
    const outsider = randomUUID();
    await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
      owner, "Source owner", `${owner}@example.invalid`, kind === "sqlite" ? 1 : true,
    ]);
    await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
      outsider, "Outsider", `${outsider}@example.invalid`, kind === "sqlite" ? 1 : true,
    ]);
    const brandId = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brandId, time);
    await brands.insertVersion(brandId, 1, brandFields, time);

    const fillers = Array.from({ length: 5 }, (_, index) => file(`pad-${index}.txt`));
    const importedFiles = [
      file("kept.txt"),
      file("scan.md", { contentType: "text/markdown", pages: [{ page: 1, text: "ok" }, { page: null, text: null }] }),
      file("huge.txt", { chars: sourceImportLimits.maxChars + 1 }),
      file("locked.pdf", { contentType: "application/pdf", encrypted: true, pages: [] }),
      file("run.bin", { contentType: "application/octet-stream" }),
      ...fillers,
      file("eleventh.txt"),
    ];
    const storage = memoryStorage();
    const traced = trace(db);
    const imported = await importSourceOriginals(traced.connection, owner, { brandId, files: importedFiles }, {
      env: storageEnv,
      storage,
      now,
    });
    assert.equal(imported.error, undefined);
    assert.equal(imported.factsApproved, false);
    assert.equal(JSON.stringify(imported).includes("v1/"), false);
    assert.equal(JSON.stringify(imported).includes(storageEnv.S3_SECRET_ACCESS_KEY), false);
    const byName = new Map(imported.files.map((item) => [item.fileName, item]));
    assert.equal(byName.get("kept.txt").status, "ready");
    assert.equal(byName.get("kept.txt").storedObjectId === null, false);
    assert.equal(byName.get("scan.md").status, "partial");
    assert.equal(byName.get("scan.md").storedObjectId === null, false);
    for (const name of ["huge.txt", "locked.pdf", "run.bin", "eleventh.txt"]) {
      assert.equal(byName.get(name).storedObjectId, null);
      assert.equal(byName.get(name).status, "failed");
    }
    assert.equal(byName.get("huge.txt").reason, "oversized");
    assert.equal(byName.get("locked.pdf").reason, "encrypted");
    assert.equal(byName.get("run.bin").reason, "unrecognized");
    assert.equal(byName.get("eleventh.txt").reason, "batch_limit");
    assert.equal(byName.get("scan.md").fragments.length, 2);
    assert.equal(byName.get("scan.md").fragments[0].page, 1);
    assert.equal(byName.get("scan.md").fragments[0].text, "ok");
    assert.equal(byName.get("scan.md").fragments[0].approved, false);
    assert.equal(byName.get("scan.md").fragments[1].text, null);
    assert.equal(byName.get("scan.md").fragments[1].approved, false);
    for (const name of ["huge.txt", "locked.pdf", "run.bin", "eleventh.txt"]) {
      assert.equal(byName.get(name).fragments.length, 0);
    }
    assert.equal(storage.calls.put, 7);
    assert.equal(traced.queries.filter((sql) => /INSERT INTO source_original\s+\(/.test(sql)).length, 1);
    assert.equal(traced.queries.filter((sql) => /INSERT INTO source_original_fragment\s+\(/.test(sql)).length, 1);
    assert.equal(traced.queries.filter((sql) => sql.includes("INSERT INTO brand_fact")).length, 0);

    const objects = await queryWithParameters(
      db,
      `SELECT file_name AS "fileName", status, visibility, "class" FROM stored_object WHERE brand_id = ? AND "class" = 'source-original'`,
      [brandId],
    );
    assert.equal(objects.length, 7);
    assert.equal(objects.every((row) => row.status === "ready" && row.visibility === "internal" && row.class === "source-original"), true);
    assert.equal(objects.some((row) => row.fileName === "huge.txt" || row.fileName === "locked.pdf" || row.fileName === "run.bin"), false);

    const read = await readSourceOriginal(db, owner, { brandId, id: byName.get("kept.txt").id }, { env: storageEnv, storage, now });
    assert.equal(read.error, undefined);
    assert.deepEqual(read.body, body);
    assert.equal((await listImportedOriginals(db, owner, brandId)).canManage, true);
    const getsAfterOwner = storage.calls.get;
    const hidden = await readSourceOriginal(db, outsider, { brandId, id: byName.get("kept.txt").id }, { env: storageEnv, storage, now });
    assert.equal(hidden.error, "NOT_FOUND");
    assert.equal(hidden.body, undefined);
    assert.equal(storage.calls.get, getsAfterOwner);

    const signed = await presignSourceOriginal(db, owner, { brandId, id: byName.get("kept.txt").id }, { env: storageEnv, storage, now });
    assert.equal(signed.error, undefined);
    assert.match(signed.url, /^http:\/\/192\.0\.2\.10:8333\//);
    const revoked = await setSourceOriginalRights(db, owner, { brandId, id: byName.get("kept.txt").id, rights: "revoked" });
    assert.equal(revoked.file.rightsStatus, "revoked");
    assert.equal(revoked.file.fileName, "kept.txt");
    const presigns = storage.calls.presign;
    const blocked = await presignSourceOriginal(db, owner, { brandId, id: byName.get("kept.txt").id }, { env: storageEnv, storage, now });
    assert.equal(blocked.error, "NOT_FOUND");
    assert.equal(blocked.url, undefined);
    assert.equal(storage.calls.presign, presigns);
    const expired = await setSourceOriginalRights(db, owner, { brandId, id: byName.get("scan.md").id, rights: "expired" });
    assert.equal(expired.file.rightsStatus, "expired");
    const expiredSign = await presignSourceOriginal(db, owner, { brandId, id: byName.get("scan.md").id }, { env: storageEnv, storage, now });
    assert.equal(expiredSign.error, "NOT_FOUND");

    await queryWithParameters(db, "UPDATE brand SET frozen_at = ? WHERE id = ?", [time, brandId]);
    const frozenSign = await presignSourceOriginal(db, owner, { brandId, id: byName.get("pad-0.txt").id }, { env: storageEnv, storage, now });
    assert.equal(frozenSign.error, "NOT_FOUND");
    const history = await listImportedOriginals(db, owner, brandId);
    assert.equal(history.error, undefined);
    assert.equal(history.canManage, false);
    const names = history.files.map((item) => item.fileName);
    assert.equal(names.includes("kept.txt") && names.includes("huge.txt") && names.includes("scan.md"), true);
    const keptHistory = history.files.find((item) => item.fileName === "kept.txt");
    assert.equal(keptHistory.rightsStatus, "revoked");
    assert.equal(keptHistory.fragments[0].readable, false);
    assert.equal(keptHistory.fragments[0].text, null);
    const storedExcerpt = await queryWithParameters(
      db,
      `SELECT excerpt FROM source_original_fragment WHERE id = ?`,
      [keptHistory.fragments[0].id],
    );
    assert.equal(storedExcerpt[0].excerpt, "ok");
    const failedFragments = await queryWithParameters(
      db,
      `SELECT count(*) AS count FROM source_original_fragment f
       JOIN source_original s ON s.id = f.source_original_id
       WHERE s.brand_id = ? AND s.status = 'failed'`,
      [brandId],
    );
    assert.equal(Number(failedFragments[0].count), 0);
    const outsiderList = await listImportedOriginals(db, outsider, brandId);
    assert.equal(outsiderList.error, "NOT_FOUND");

    const plan = await explain(
      db,
      `SELECT id FROM source_original WHERE owner_id = ? AND brand_id = ? ORDER BY created_at DESC, batch_id DESC, id DESC LIMIT ?`,
      [owner, brandId, 50],
    );
    const planText = JSON.stringify(plan);
    assert.match(planText, /source_original_(owner_idx|brand_idx)/);
    assert.equal(planText.includes("Seq Scan"), false);
  });

  test(`${kind}: fragments record a page, a missing page, and an unapproved fact conflict`, async (t) => {
    const fixture = await testDatabase(kind, { migrateNow: false });
    const ddl = await testDatabase(kind, { ddl: true });
    t.after(() => fixture.cleanup());
    t.after(() => ddl.cleanup());
    const baseline = kind === "sqlite" ? "0027_real_fallen_one" : "0028_new_patch";
    await migrateThrough(fixture.connection, baseline);
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, ...fixture.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.deepEqual(await structure(fixture.connection), await structure(ddl.connection));
    const db = fixture.connection;
    const owner = randomUUID();
    const member = randomUUID();
    const otherMember = randomUUID();
    const expiredMember = randomUUID();
    for (const userId of [owner, member, otherMember, expiredMember]) {
      await queryWithParameters(db, 'INSERT INTO "user" (id, name, email, email_verified) VALUES (?, ?, ?, ?)', [
        userId, "Fragment user", `${userId}@example.invalid`, kind === "sqlite" ? 1 : true,
      ]);
    }
    const brandId = randomUUID();
    const otherBrandId = randomUUID();
    const brands = new BrandDao(db);
    await brands.insertBrand(owner, brandId, time);
    await brands.insertVersion(brandId, 1, brandFields, time);
    await brands.insertBrand(otherMember, otherBrandId, time);
    await brands.insertVersion(otherBrandId, 1, { ...brandFields, name: "其他品牌" }, time);
    const differentId = randomUUID();
    const sameId = randomUUID();
    const otherFactId = randomUUID();
    const factContent = (claim) => JSON.stringify({
      category: "specification",
      title: "保修",
      claim,
      sourceType: "internal",
      sourceReference: "fixture",
      sourceLocator: "第 1 页",
      sourceExcerpt: "fixture",
      sourceDate: "",
      permission: "unknown",
      validity: "unspecified",
      validThrough: "",
      pasteId: null,
      pasteSpan: null,
    });
    await queryWithParameters(db, `INSERT INTO brand_fact_version
      (brand_id, id, fact_id, version, entity_version, revision, state, content, created_at, confirmed_by, confirmed_at, revoked_at)
      VALUES (?, ?, ?, 3, 1, 1, 'approved', ?, ?, ?, ?, NULL),
             (?, ?, ?, 4, 1, 1, 'approved', ?, ?, ?, ?, NULL),
             (?, ?, ?, 1, 1, 1, 'approved', ?, ?, ?, ?, NULL)`, [
      brandId, differentId, differentId, factContent("保修一年"), time, owner, time,
      brandId, sameId, sameId, factContent("北岸保修两年"), time, owner, time,
      otherBrandId, otherFactId, otherFactId, factContent("另一品牌事实"), time, otherMember, time,
    ]);
    await queryWithParameters(db, `INSERT INTO brand_member_grant
      (id, user_id, brand_id, role, active, expires_at, created_at, revoked_at)
      VALUES (?, ?, ?, 'owner', 1, NULL, ?, NULL),
             (?, ?, ?, 'member', 1, NULL, ?, NULL),
             (?, ?, ?, 'member', 1, NULL, ?, NULL),
             (?, ?, ?, 'member', 1, ?, ?, NULL)`, [
      randomUUID(), owner, brandId, time,
      randomUUID(), member, brandId, time,
      randomUUID(), otherMember, otherBrandId, time,
      randomUUID(), expiredMember, brandId, "2020-01-01T00:00:00.000Z", time,
    ]);
    const beforeFacts = await queryWithParameters(db, "SELECT count(*) AS count FROM brand_fact_version WHERE brand_id = ?", [brandId]);
    const text = "北岸保修两年";
    const imported = await importSourceOriginals(db, owner, {
      brandId,
      files: [
        file("two.txt", { chars: [...text].length, pages: pagesFromText(`${text}\f`), body: Uint8Array.from(Buffer.from(`${text}\f`)) }),
        file("unpaginated.txt", { pages: pagesFromText("ok") }),
        file("locked.pdf", { contentType: "application/pdf", encrypted: true, pages: [], chars: 0, body: Uint8Array.from([1]) }),
      ],
    }, { env: storageEnv, storage: memoryStorage(), now });
    assert.equal(imported.factsApproved, false);
    const afterFacts = await queryWithParameters(db, "SELECT count(*) AS count FROM brand_fact_version WHERE brand_id = ?", [brandId]);
    assert.equal(Number(afterFacts[0].count), Number(beforeFacts[0].count));
    const two = imported.files.find((item) => item.fileName === "two.txt");
    const locked = imported.files.find((item) => item.fileName === "locked.pdf");
    assert.equal(two.status, "partial");
    assert.equal(two.fragments.length, 2);
    assert.equal(two.fragments[0].page, 1);
    assert.equal(two.fragments[0].text, text);
    assert.equal(two.fragments[0].approved, false);
    assert.deepEqual(two.fragments[0].conflicts, [{ factVersionId: differentId, version: 3 }]);
    assert.equal(two.fragments[1].page, 2);
    assert.equal(two.fragments[1].text, null);
    assert.deepEqual(two.fragments[1].conflicts, []);
    assert.equal(two.fragments[1].approved, false);
    assert.equal(locked.fragments.length, 0);
    assert.equal(locked.status, "failed");
    assert.equal(JSON.stringify(two.fragments).includes(otherFactId), false);

    const listedTrace = trace(db);
    const seen = await listImportedOriginals(listedTrace.connection, member, brandId, now);
    assert.equal(seen.viewer, "member");
    assert.equal(seen.canManage, false);
    assert.equal(seen.files.find((item) => item.fileName === "two.txt").fragments[0].text, text);
    assert.equal(listedTrace.queries.filter((sql) => /FROM source_original_fragment\s/.test(sql)).length, 1);
    assert.equal(listedTrace.queries.filter((sql) => sql.includes("FROM source_original_fragment_conflict")).length, 1);
    const deniedTrace = trace(db);
    const denied = await listImportedOriginals(deniedTrace.connection, otherMember, brandId, now);
    assert.equal(denied.error, "NOT_FOUND");
    assert.equal(JSON.stringify(denied).includes(text), false);
    assert.equal(deniedTrace.queries.some((sql) => sql.includes("source_original_fragment")), false);
    const expired = await listImportedOriginals(db, expiredMember, brandId, now);
    assert.equal(expired.error, "NOT_FOUND");

    const id = two.fragments[0].id;
    const scope = { ownerId: owner, brandId };
    const clock = () => now;
    const create = { action: "createFromFragment", id };
    const run = (actorId, command) => executeFactCommand(db, { ownerId: actorId, brandId }, command, clock);
    const linkedRead = () => readFactWorkspace(db, scope, { fact: id }, clock);
    assert.deepEqual(await executeFactCommand(db, { ownerId: otherMember, brandId: otherBrandId }, create, clock), { error: "notFound" });
    assert.deepEqual(await run(expiredMember, create), { error: "notFound" });
    assert.deepEqual(await run(owner, { ...create, id: two.fragments[1].id }), { error: "notFound" });
    const unpaginatedId = imported.files.find((item) => item.fileName === "unpaginated.txt").fragments[0].id;
    assert.deepEqual(await run(owner, { ...create, id: unpaginatedId }), { id: unpaginatedId });
    const unpaginated = await readFactWorkspace(db, scope, { fact: unpaginatedId }, clock);
    assert.equal(unpaginated.originalFragment.page, null);
    assert.equal(unpaginated.fact.fields.sourceLocator, "");
    assert.deepEqual(await Promise.all([run(member, create), run(member, create)]), [{ id }, { id }]);
    const pending = await linkedRead();
    assert.equal(pending.versions.items.filter((item) => item.id === id).length, 1);
    assert.equal(pending.fact.state, "pending_confirmation");
    assert.equal(pending.fact.fields.permission, "unknown");
    assert.equal(pending.fact.fields.sourceExcerpt, "");
    assert.deepEqual(pending.originalFragment, { id, fileName: "two.txt", page: 1, excerpt: text });
    const fields = { ...pending.fact.fields, title: "Public title", claim: "Public claim", sourceExcerpt: "Public excerpt",
      sourceDate: time.slice(0, 10), permission: "public", validity: "longTerm" };
    assert.deepEqual(await run(member, { action: "edit", id, revision: 1, fields }), { id });
    const use = { factVersionIds: [id], contentVersionId: randomUUID(), stage: "delivery" };
    const checkUse = () => withEligibleFacts(db, scope, use, async () => "used", clock);
    assert.deepEqual(await checkUse(), { error: "factInvalid", ids: [id] });
    assert.equal((await listApprovedBriefFacts(db, owner, brandId, time)).some((item) => item.id === id), false);
    assert.equal((await saveApprovalPolicy(db, owner, {
      brandId, dualControl: true, duties: [{ userId: member, factApprover: true, contentApprover: false }],
    }, time)).dualControl, true);
    const approve = { action: "approve", id, revision: 2, confirmed: true, conflictId: null, revokeConflict: false };
    assert.deepEqual(await run(member, approve), { error: "separation" });
    const alternate = { brandId, versionId: id, kind: "fact" };
    const deniedApproval = await decideApproval(db, member, alternate, time);
    assert.equal(deniedApproval.error, "SEPARATION");
    assert.deepEqual(await run(owner, approve), { id });
    assert.deepEqual(await checkUse(), { data: "used" });
    const eligibilityTrace = trace(db);
    assert.equal((await listApprovedBriefFacts(eligibilityTrace.connection, owner, brandId, time)).some((item) => item.id === id), true);
    const eligibilityQueries = eligibilityTrace.queries.filter((sql) => sql.includes("FROM source_original_fragment f"));
    assert.equal(eligibilityQueries.length, 1);
    const eligibilityPlan = JSON.stringify(await explain(db, eligibilityQueries[0], [brandId, owner, id]));
    assert.match(eligibilityPlan, /source_original_fragment_pkey|sqlite_autoindex_source_original_fragment_1/);
    assert.match(eligibilityPlan, /source_original_(pkey|owner_idx|brand_idx)|sqlite_autoindex_source_original_1/);
    console.log(`${kind} linked fact eligibility plan ${eligibilityPlan}`);

    const revoked = await setSourceOriginalRights(db, owner, { brandId, id: two.id, rights: "revoked" });
    assert.equal(revoked.file.rightsStatus, "revoked");
    const afterRevoke = await listImportedOriginals(db, owner, brandId, now);
    const hidden = afterRevoke.files.find((item) => item.fileName === "two.txt").fragments[0];
    assert.equal(hidden.readable, false);
    assert.equal(hidden.text, null);
    assert.equal(hidden.approved, false);
    assert.deepEqual(hidden.conflicts, [{ factVersionId: differentId, version: 3 }]);
    assert.equal((await linkedRead()).originalFragment, null);
    assert.deepEqual(await run(owner, create), { error: "notFound" });
    assert.deepEqual(await checkUse(), { error: "factInvalid", ids: [id] });
    assert.equal((await listApprovedBriefFacts(db, owner, brandId, time)).some((item) => item.id === id), false);
    const kept = await queryWithParameters(db, "SELECT excerpt FROM source_original_fragment WHERE id = ?", [hidden.id]);
    assert.equal(kept[0].excerpt, text);
    const conflictCount = await queryWithParameters(
      db,
      "SELECT count(*) AS count FROM source_original_fragment_conflict WHERE fragment_id = ?",
      [hidden.id],
    );
    assert.equal(Number(conflictCount[0].count), 1);

    const fragmentPlan = await explain(
      db,
      `SELECT id, source_original_id AS "sourceId", ordinal, page, excerpt, candidate_state AS "candidateState"
       FROM source_original_fragment
       WHERE brand_id = ? AND source_original_id IN (?)
       ORDER BY source_original_id, ordinal`,
      [brandId, two.id],
    );
    const conflictPlan = await explain(
      db,
      `SELECT fragment_id AS "fragmentId", fact_version_id AS "factVersionId", fact_version AS "factVersion"
       FROM source_original_fragment_conflict
       WHERE brand_id = ? AND fragment_id IN (?)
       ORDER BY fragment_id, fact_version, fact_version_id`,
      [brandId, two.fragments[0].id],
    );
    const fragmentPlanText = JSON.stringify(fragmentPlan);
    const conflictPlanText = JSON.stringify(conflictPlan);
    assert.match(fragmentPlanText, /source_original_fragment_(brand_idx|ordinal_uidx)/);
    assert.match(conflictPlanText, /source_original_fragment_conflict_(brand_idx|uidx)/);
    assert.equal(fragmentPlanText.includes("Seq Scan"), false);
    assert.equal(conflictPlanText.includes("Seq Scan"), false);
    console.log(`${kind} fragment plan ${fragmentPlanText}`);
    console.log(`${kind} conflict plan ${conflictPlanText}`);
  });
}
