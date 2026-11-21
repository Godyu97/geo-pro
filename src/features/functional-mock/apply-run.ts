import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { defaultExpiresAt } from "../capabilities/rules.ts";
import { CapabilityDao } from "../capabilities/dao.ts";
import { executeMonitoringRun } from "../monitoring/execution.ts";
import { MonitoringDao } from "../monitoring/dao.ts";
import { quotaChangeSchema, type GrantSnapshot } from "../quotas/contracts.ts";
import { QuotaDao } from "../quotas/dao.ts";
import { grantState } from "../quotas/ledger.ts";
import { mockVendorId } from "./channels.ts";
import { mockSampleAnswer, mockSamplingBudgetMinor, mockSamplingCountLimit } from "./sampling.ts";

/** Fixture sampling grant. reason stays inside the existing enum and is not a pilot approval. */
export async function applyMockSamplingQuota(db: DatabaseConnection, actorId: string, brandId: string) {
  const now = new Date().toISOString();
  return db.transaction(async (transaction) => {
    const dao = new QuotaDao(transaction);
    const brand = await dao.lockBrand(brandId, actorId);
    if (brand !== "active") return { ok: false as const, error: "not-found" };
    const current = await dao.grant(brandId, "sampling");
    if (current && current.currency !== "CNY") return { ok: false as const, error: "currency" };
    if (current && grantState(current, now) === "active") {
      return { ok: true as const, version: current.version, reused: true as const };
    }
    const command = quotaChangeSchema.parse({
      action: "set",
      brandId,
      kind: "sampling",
      operationId: randomUUID(),
      actorId,
      expectedVersion: current?.version ?? null,
      reason: "correction",
      countLimit: mockSamplingCountLimit,
      budgetMinor: mockSamplingBudgetMinor,
      currency: "CNY",
      expiresAt: defaultExpiresAt(now),
    });
    if (command.action !== "set") return { ok: false as const, error: "invalid" };
    const after: GrantSnapshot = {
      countLimit: command.countLimit,
      budgetMinor: command.budgetMinor,
      currency: command.currency,
      expiresAt: command.expiresAt,
      changedAt: now,
      version: (current?.version ?? 0) + 1,
      action: "set",
    };
    const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    await dao.appendGrant(command, after, fingerprint);
    return { ok: true as const, version: after.version, reused: false as const };
  });
}

/** Runs only when every slot channel is the functional-mock vendor. Results stay synthetic. */
export async function executeFunctionalMockRun(db: DatabaseConnection, ownerId: string, runId: string) {
  const monitoring = new MonitoringDao(db);
  const run = await monitoring.runForOwner(ownerId, runId);
  if (!run) return { error: "NOT_FOUND" as const, next: null };
  const slots = await monitoring.slots([run.id]);
  const channels = await new CapabilityDao(db).latestByIds([...new Set(slots.map((slot) => slot.channelId))]);
  if (channels.length === 0 || channels.some((channel) => channel.vendorId !== mockVendorId)) {
    return { error: "REAL_CHANNEL_CLOSED" as const, next: "await-channel" as const };
  }
  return executeMonitoringRun(db, ownerId, runId, {
    label: "isolated",
    sample(input) {
      return Promise.resolve(mockSampleAnswer(input.questionId));
    },
  });
}
