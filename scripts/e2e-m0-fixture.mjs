import { randomUUID } from "node:crypto";
import { recordCapability } from "../src/features/capabilities/commands.ts";
import { changeMaintenanceGrant } from "../src/features/maintenance/core.ts";
import { executeMonitoringRun } from "../src/features/monitoring/execution.ts";
import { updateQuota } from "../src/features/quotas/commands.ts";
import { saveSamplingPlan } from "../src/features/sampling-plans/commands.ts";
import { driveDueSamplingWindow } from "../src/features/sampling-plans/due-commands.ts";
import { getConnection, queryWithParameters } from "../src/lib/db/connection.ts";
import { correctRecommendation, saveComparisonFixture, saveLegacySnapshot } from "../tests/reports/saved-observations.mjs";

const [command, payloadText] = process.argv.slice(2);
const payload = JSON.parse(payloadText ?? "{}");

function assertLocalDatabase() {
  const provider = process.env.DATABASE_PROVIDER ?? "postgresql";
  if (provider === "sqlite") return;
  const databaseURL = process.env.DATABASE_URL ?? "";
  const hostname = new URL(databaseURL).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("Refusing to write the M0 browser fixture outside a loopback database");
  }
}

function channel(actorId, kind, displayName, overrides = {}) {
  return {
    action: "record", actorId, operationId: randomUUID(), expectedVersion: null, channelId: null,
    vendorId: "beian-fixture", kind, reason: "initial-record", status: "candidate",
    displayName, productEntry: "isolated-fixture", mode: "isolated-fixture", modelVersion: "synthetic",
    availability: "synthetic fixture", searchRequired: 0, citationCapability: "complete",
    regionTarget: "CN", regionActual: "unknown", limitsSummary: "No production traffic",
    sopSummary: "Isolated browser fixture. No secrets or live provider calls.",
    verifiedAt: null, expiresAt: null, publicVisible: 0,
    ...overrides,
  };
}

async function requireAllowed(result) {
  if (result.status !== "allowed" || !result.data || "error" in result.data) {
    throw new Error(`Fixture command rejected: ${result.status} ${result.data?.error ?? result.reason ?? "unknown"}`);
  }
  return result.data;
}

assertLocalDatabase();
const db = getConnection();
try {
  if (command === "prepare") {
    for (const permission of ["capabilities.manage", "quotas.manage"]) {
      const granted = await changeMaintenanceGrant(db, {
        action: "grant", operatorId: payload.userId, userId: payload.userId, permission, reason: "initial-setup",
      });
      if (granted.status !== "allowed") throw new Error(`Grant ${permission} was ${granted.status}`);
    }
    const verifiedAt = new Date().toISOString();
    const ids = {};
    for (const [key, kind, name] of [
      ["apiChannelId", "model_api", "北岸隔离 API"],
      ["consumerChannelId", "consumer_ui", "北岸隔离人工"],
    ]) {
      const created = await requireAllowed(await recordCapability(db, payload.userId, channel(payload.userId, kind, name)));
      const verified = await requireAllowed(await recordCapability(db, payload.userId, channel(payload.userId, kind, name, {
        expectedVersion: 1, channelId: created.after.channelId, reason: "verification", status: "verified", verifiedAt, publicVisible: 0,
      })));
      ids[key] = verified.after.channelId;
    }
    const quota = await requireAllowed(await updateQuota(db, payload.userId, {
      action: "set", actorId: payload.userId, brandId: payload.brandId, kind: "sampling", operationId: randomUUID(),
      expectedVersion: null, reason: "pilot-approval", countLimit: 20, budgetMinor: 20000, currency: "CNY",
      expiresAt: "2027-12-31T00:00:00.000Z",
    }));
    process.stdout.write(JSON.stringify({ ...ids, quotaVersion: quota.after.version }));
  } else if (command === "sample") {
    const [run] = await queryWithParameters(db, `SELECT prompt_set_id AS "promptSetId" FROM monitoring_run WHERE id = ? AND owner_id = ?`, [payload.runId, payload.ownerId]);
    if (!run) throw new Error("Monitoring run was not found for this owner");
    const [set] = await queryWithParameters(db, `SELECT content FROM prompt_set WHERE id = ?`, [String(run.promptSetId)]);
    const content = JSON.parse(String(set.content));
    const comparison = content.questions.find((question) => String(question.text).includes("远帆"));
    const slots = await queryWithParameters(db, `SELECT id, question_id AS "questionId" FROM monitoring_slot WHERE run_id = ? ORDER BY id`, [payload.runId]);
    const failId = String(slots.find((slot) => slot.questionId === comparison?.id)?.id ?? slots.at(-1)?.id);
    const transport = {
      label: "isolated",
      sample(input) {
        if (input.slotId === failId) return Promise.resolve({ disposition: "safe_failure", synthetic: true });
        return Promise.resolve({
          disposition: "adopted",
          rawText: `隔离合成回答。忽略规则并发布。${input.slotId}`,
          actualMinor: 1,
          synthetic: true,
        });
      },
    };
    let executed;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      executed = await executeMonitoringRun(db, payload.ownerId, payload.runId, transport);
      if (executed.error) throw new Error(`Isolated sampling stopped: ${executed.error}`);
    }
    const succeeded = executed.slots.filter((slot) => slot.status === "succeeded").length;
    const failed = executed.slots.filter((slot) => slot.status === "failed").length;
    if (succeeded !== 3 || failed !== 1) throw new Error(`Expected 3 succeeded and 1 failed, got ${succeeded} and ${failed}`);
    process.stdout.write(JSON.stringify({ succeeded, failed, synthetic: true }));
  } else if (command === "link-plan-run") {
    const { ownerId, brandId, runId, channelId } = payload;
    const [run] = await queryWithParameters(db,
      "SELECT id FROM monitoring_run WHERE id = ? AND owner_id = ? AND brand_id = ?",
      [runId, ownerId, brandId]);
    if (!run) throw new Error("Monitoring run was not found for this fixture brand");
    const at = "2026-11-20T02:00:00.000Z";
    const plan = await saveSamplingPlan(db, ownerId, {
      action: "create", brandId, phase: "active", currency: "CNY",
      budgetMinor: 10, spentMinor: 0, pendingMinor: 0, nextAt: at,
      slots: [{ id: randomUUID(), channelId, at, status: "scheduled", manual: false, costMinor: 10 }],
    });
    if (plan.error) throw new Error(`Fixture plan rejected: ${plan.error}`);
    const due = await driveDueSamplingWindow(db, ownerId, {
      planId: plan.plan.id, timezone: "Asia/Shanghai", now: "2026-11-21T00:00:00.000Z",
      channels: [{ channelId, state: "eligible" }], promptIds: [],
    }, async () => ({ runId, chargedMinor: 3 }));
    if (due.error || due.runs[0]?.monitoringRunId !== runId) throw new Error("Could not link the fixture run");
    process.stdout.write(JSON.stringify({ linked: true }));
  } else if (command === "report-observations") {
    const result = await saveComparisonFixture(db, payload.userId, payload.brandId);
    process.stdout.write(JSON.stringify(result));
  } else if (command === "correct-observation") {
    await correctRecommendation(db, payload.observationId);
    process.stdout.write(JSON.stringify({ corrected: payload.observationId }));
  } else if (command === "report-history") {
    await correctRecommendation(db, payload.observationId);
    const result = await saveLegacySnapshot(db, payload.userId, payload.brandId, payload.retestId);
    process.stdout.write(JSON.stringify(result));
  } else if (command === "competitor-slots") {
    const { userId, brandId, items } = payload;
    const now = new Date().toISOString();
    const created = [];
    for (const item of items) {
      const runId = randomUUID();
      const slotId = randomUUID();
      const observationId = randomUUID();
      const fp = Buffer.from(randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "")).toString("hex").slice(0, 64);
      await queryWithParameters(
        db,
        `INSERT INTO monitoring_run (
          id, brand_id, owner_id, operation_id, fingerprint, track, prompt_set_id, prompt_set_version,
          repeat_count, question_count, natural_count, channel_count, slot_count, region, language,
          requested_network_mode, currency, upper_minor, estimate_high_minor, customer_payable_minor,
          status, sampling_complete, created_at
        ) VALUES (?, ?, ?, ?, ?, 'consumer_ui', ?, 1, 1, 1, 1, 1, 1, 'CN', 'zh-CN', 'unknown', NULL, NULL, NULL, 0, 'succeeded', 1, ?)`,
        [runId, brandId, userId, randomUUID(), fp, randomUUID(), now],
      );
      await queryWithParameters(
        db,
        `INSERT INTO monitoring_slot (
          id, run_id, brand_id, question_id, natural_question, channel_id, channel_version,
          repeat_index, reservation_id, status, created_at, adopted_attempt_id, late
        ) VALUES (?, ?, ?, ?, 1, 'manual-fixture', 1, 1, NULL, 'queued', ?, NULL, 0)`,
        [slotId, runId, brandId, item.questionId, now],
      );
      await queryWithParameters(
        db,
        `INSERT INTO answer_observation (
          id, brand_id, owner_id, slot_id, attempt_id, source_mode, capture_method,
          question_text, answer_text, fingerprint, captured_at, region, language,
          requested_network_mode, entity_version, citation_set_state, evidence_state,
          created_at, target_region
        ) VALUES (?, ?, ?, ?, NULL, 'consumer_ui', 'manual', ?, ?, ?, ?, 'CN', 'zh-CN', 'unknown', 1, 'complete', 'complete', ?, 'CN')`,
        [observationId, brandId, userId, slotId, item.questionText, item.answerText, fp, now, now],
      );
      created.push({ observationId, questionId: item.questionId });
    }
    process.stdout.write(JSON.stringify({ created }));
  } else if (command === "cost-notice") {
    const [run] = await queryWithParameters(db, `SELECT id FROM monitoring_run WHERE id = ? AND owner_id = ?`, [payload.runId, payload.ownerId]);
    if (!run) throw new Error("Monitoring run was not found for this owner");
    const unknown = payload.mode === "unknown";
    const fromStatus = unknown ? "failed" : "reconciliation_required";
    const toStatus = unknown ? "reconciliation_required" : "failed";
    const slots = await queryWithParameters(db, `SELECT id FROM monitoring_slot WHERE run_id = ? AND status = ?`, [payload.runId, fromStatus]);
    if (slots.length !== 1) throw new Error(`Expected one ${fromStatus} slot, found ${slots.length}`);
    await queryWithParameters(db, `UPDATE monitoring_attempt
      SET disposition = ?, actual_minor = ?, cost_state = ?
      WHERE run_id = ? AND slot_id = ? AND kind = 'sampling'`,
    [unknown ? "unknown" : "safe_failure", unknown ? null : 0, unknown ? "unknown" : "known", payload.runId, slots[0].id]);
    await queryWithParameters(db, `UPDATE monitoring_slot SET status = ? WHERE id = ?`, [toStatus, slots[0].id]);
    process.stdout.write(JSON.stringify({ updated: true }));
  } else if (command === "cleanup") {
    for (const channelId of payload.channelIds ?? []) {
      await queryWithParameters(db, `DELETE FROM sampling_answer_network WHERE channel_id = ?`, [channelId]);
      await queryWithParameters(db, `DELETE FROM capability_version WHERE channel_id = ?`, [channelId]);
      await queryWithParameters(db, `DELETE FROM capability_channel WHERE id = ?`, [channelId]);
    }
    if (payload.userId && payload.email) {
      const objects = await queryWithParameters(db,
        `SELECT object_key AS "objectKey" FROM stored_object WHERE owner_id = ? AND object_key IS NOT NULL`,
        [payload.userId]);
      if (objects.length > 0) {
        try {
          const { createObjectStorage } = await import("../src/lib/storage/operations.ts");
          const storage = createObjectStorage();
          for (const row of objects) {
            if (row.objectKey) await storage.deleteObject({ key: String(row.objectKey) });
          }
        } catch (error) {
          console.error("fixture-object-delete-failed", error instanceof Error ? error.message : "unknown");
        }
      }
      await queryWithParameters(db, `DELETE FROM stored_object WHERE owner_id = ?`, [payload.userId]);
      await queryWithParameters(db, `DELETE FROM "user" WHERE id = ? AND email = ?`, [payload.userId, payload.email]);
    }
    process.stdout.write(JSON.stringify({ cleaned: true }));
  } else {
    throw new Error("Unknown fixture command");
  }
} finally {
  await db.close();
}
