import "server-only";

import { z } from "zod";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "../brands/contracts.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";
import { minorAmountSchema, quotaCurrencySchema, quotaKindSchema, type GrantSnapshot } from "./contracts.ts";
import { QuotaDao } from "./dao.ts";

const unit = { brandId: brandIdSchema, kind: quotaKindSchema, reservationId: z.uuid() };
const attempt = { ...unit, attemptId: z.uuid() };
const ledgerCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...unit, action: z.literal("reserve"), version: z.int().positive(), upperMinor: minorAmountSchema, currency: quotaCurrencySchema }),
  z.strictObject({ ...attempt, action: z.literal("start"), upperMinor: minorAmountSchema, currency: quotaCurrencySchema }),
  z.strictObject({ ...attempt, action: z.literal("reconcile"), actualMinor: minorAmountSchema.nullable(), currency: quotaCurrencySchema }),
  z.strictObject({ ...unit, action: z.literal("settle") }),
  z.strictObject({ ...unit, action: z.literal("release"), noFurtherResult: z.literal(true) }),
]);

type LedgerCommand = z.infer<typeof ledgerCommandSchema>;
type LedgerOutcome = "applied" | "replayed" | "conflict" | "not-found" | "not-entitled" | "over-limit" | "unresolved";

export function grantState(grant: GrantSnapshot | null, time: string) {
  if (!grant) return "ungranted";
  if (grant.action === "revoke") return "revoked";
  return grant.expiresAt <= time ? "expired" : "active";
}

// Trusted callers supply the owner from the authorized resource. An applied start
// reserves one attempt. Callers must also enforce the run, provider and consent
// checks before any invocation. A replay cannot authorize another attempt.
export async function applyQuotaLedger(
  connection: DatabaseConnection, ownerId: string, input: LedgerCommand, now = () => new Date().toISOString(),
): Promise<LedgerOutcome> {
  const command = ledgerCommandSchema.parse(input);
  return connection.transaction(async (transaction) => {
    const dao = new QuotaDao(transaction);
    const brand = await dao.lockBrand(command.brandId, opaqueIdSchema.parse(ownerId));
    if (!brand) return "not-found";
    const time = now();
    const reservation = await dao.reservation(command);

    if (command.action === "reserve" || command.action === "start") {
      if (command.action === "reserve" && reservation) {
        return reservation.upperMinor === command.upperMinor && reservation.grantVersion === command.version
          && reservation.currency === command.currency ? "replayed" : "conflict";
      }
      if (command.action === "start") {
        if (!reservation) return "not-found";
        const existing = await dao.attempt(command);
        if (existing) {
          return existing.upperMinor === command.upperMinor && reservation.currency === command.currency ? "replayed" : "conflict";
        }
        if (reservation.state !== "reserved") return "conflict";
      }

      const grant = await dao.grant(command.brandId, command.kind);
      if (!grant || brand !== "active" || grantState(grant, time) !== "active" || grant.currency !== command.currency) return "not-entitled";
      if (command.action === "reserve" && grant.version !== command.version) return "conflict";
      const ledger = await dao.ledger(command.brandId, command.kind);
      const nextCount = ledger.reserved + ledger.settled + (command.action === "reserve" ? 1 : 0);
      const nextBudget = ledger.committedMinor + (command.action === "reserve" ? command.upperMinor : 0);
      if (nextCount > grant.countLimit || nextBudget > grant.budgetMinor) return "over-limit";

      if (command.action === "reserve") {
        await dao.insertReservation(command, grant.version, command.upperMinor, time);
      } else {
        if (!reservation) return "not-found";
        const costs = await dao.attemptTotals(command);
        if (costs.unresolved) return "unresolved";
        if (costs.actual + command.upperMinor > reservation.upperMinor) return "over-limit";
        await dao.insertAttempt(command, command.upperMinor, time);
      }
      return "applied";
    }

    if (!reservation) return "not-found";
    if (command.action === "reconcile") {
      const existing = await dao.attempt(command);
      if (!existing) return "not-found";
      if (command.currency !== reservation.currency) return "conflict";
      if (existing.state === "known") return existing.actualMinor === command.actualMinor ? "replayed" : "conflict";
      if (existing.state === "unknown" && command.actualMinor === null) return "replayed";
      await dao.updateAttempt(command, command.actualMinor, time);
      return "applied";
    }

    const target = command.action === "settle" ? "settled" : "released";
    if (reservation.state === target) return "replayed";
    if (reservation.state !== "reserved") return "conflict";
    const costs = await dao.attemptTotals(command);
    if (command.action === "release" && costs.unresolved > 0) return "unresolved";
    if (command.action === "settle" && costs.attempts === 0) return "conflict";
    await dao.finalize(command, target, time);
    return "applied";
  });
}
