import "server-only";

import { createHash } from "node:crypto";
import { runMaintenanceAction } from "../maintenance/core.ts";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { grantValues, quotaChangeSchema, type GrantSnapshot, type QuotaChange, type QuotaError } from "./contracts.ts";
import { QuotaDao } from "./dao.ts";

type ChangeResult =
  | { before: GrantSnapshot | null; after: GrantSnapshot }
  | { error: QuotaError; current?: GrantSnapshot | null };

export async function updateQuota(connection: DatabaseConnection, actorId: string, command: QuotaChange, now = () => new Date().toISOString()) {
  const parsed = quotaChangeSchema.parse(command);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
  return runMaintenanceAction(connection, actorId, "quota.write", async (transaction): Promise<ChangeResult> => {
    if (parsed.actorId !== actorId) return { error: "SESSION_CHANGED" };
    const dao = new QuotaDao(transaction);
    const { brandId, kind } = parsed;
    const brandStatus = await dao.lockBrand(brandId);
    if (!brandStatus || brandStatus === "frozen") return { error: "NOT_FOUND" };

    const existing = await dao.previousChange(parsed);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { error: "OPERATION_CONFLICT" };
      const before = existing.after.version > 1 ? await dao.grant(brandId, kind, existing.after.version - 1) : null;
      return { before, after: existing.after };
    }

    const before = await dao.grant(brandId, kind);
    if ((before?.version ?? null) !== parsed.expectedVersion) {
      return { error: "VERSION_CONFLICT", current: before };
    }
    const changedAt = now();
    const values = parsed.action === "set" ? grantValues.parse(parsed) : before;
    if (!values || (parsed.action === "set" && (brandStatus !== "active" || values.expiresAt <= changedAt))) {
      return { error: "INVALID_INPUT" };
    }
    if (before && values.currency !== before.currency && (await dao.ledger(brandId, kind)).records > 0) {
      return { error: "CURRENCY_CONFLICT" };
    }
    const after: GrantSnapshot = {
      countLimit: values.countLimit, budgetMinor: values.budgetMinor, currency: values.currency,
      expiresAt: values.expiresAt, changedAt, version: (before?.version ?? 0) + 1, action: parsed.action,
    };
    await dao.appendGrant(parsed, after, fingerprint);
    return { before, after };
  });
}
