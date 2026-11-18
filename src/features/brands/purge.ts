import "server-only";

import { z } from "zod";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { brandIdSchema } from "./contracts.ts";
import { BrandDao } from "./dao.ts";
import {
  costCursorSchema, PurgeDao, purgeCursorSchema, purgeMarkerSchema, purgePageSize, purgeTargetSchema,
  type PurgeIssue, type PurgeMarker, type PurgeTarget,
} from "./purge-dao.ts";

const steps = ["contents", "exports", "costs"] as const;
const batchSchema = z.strictObject({
  limit: z.int().min(1).max(purgePageSize).default(purgePageSize),
  after: purgeCursorSchema.optional(),
});
const replaySchema = z.array(purgeMarkerSchema.refine(({ frozenAt, startedAt }) => frozenAt <= startedAt))
  .max(purgePageSize);

type PurgeReceipt = NonNullable<Awaited<ReturnType<PurgeDao["receipt"]>>>;
type PurgeResult = {
  target: PurgeTarget;
  status: "cleared" | "incomplete" | "skipped" | "failed";
  receipt: PurgeReceipt | null;
  remaining: readonly (typeof steps[number])[];
};
const serverClock = () => new Date().toISOString();

async function purgeBrand(
  db: DatabaseConnection, target: PurgeTarget, clock: () => string, marker?: PurgeMarker,
): Promise<PurgeResult> {
  try {
    return await db.transaction(async (tx) => {
      const dao = new PurgeDao(tx);
      await new BrandDao(tx).lockOwner(target.ownerId);
      const brand = await dao.lockBrand(target.brandId);
      const receipt = await dao.receipt(target);
      if (brand && brand.ownerId !== target.ownerId) {
        return { target, status: marker ? "failed" : "skipped", receipt: null, remaining: steps };
      }
      if (marker && receipt && (receipt.frozenAt !== marker.frozenAt || receipt.startedAt !== marker.startedAt)) {
        return { target, status: "failed", receipt, remaining: steps };
      }
      if (receipt?.step === steps.length) {
        return { target, status: brand ? "failed" : "cleared", receipt, remaining: [] };
      }

      const now = clock();
      const removal = receipt ?? marker ?? (brand?.frozenAt && brand.restoreUntil && brand.frozenAt <= now && brand.restoreUntil <= now
        ? { ...target, frozenAt: brand.frozenAt, startedAt: now }
        : null);
      if (!removal) return { target, status: "skipped", receipt: null, remaining: steps };
      if (!receipt) {
        // A recovered database can predate the original freeze. The batch runs
        // while offline and must deny all normal reads even if a step fails.
        if (marker && brand) await dao.freezeRestoredBrand(marker);
        await dao.start(removal);
      }

      let index = receipt?.step ?? 0;
      let issue: PurgeIssue = null;
      for (; index < steps.length; index++) {
        const step = steps[index];
        try {
          const done = await tx.savepoint(async (connection) => {
            const stage = new PurgeDao(connection);
            if (step === "contents") await stage.clearContents(target, brand?.createdAt ?? null);
            if (step === "exports") await stage.clearExports(removal);
            return step === "costs" ? stage.clearLedger(target) : true;
          });
          if (!done) {
            issue = "unresolved-costs";
            break;
          }
        } catch {
          issue = `${step}-failed`;
          break;
        }
      }

      const completed = index === steps.length;
      const progress = await dao.checkpoint(target, index, issue, completed ? now : null);
      return {
        target, status: completed ? "cleared" : "incomplete", receipt: progress, remaining: steps.slice(index),
      };
    });
  } catch {
    // The transaction outcome can be unknown. Inspect the persisted receipt
    // before acting on a failure, and never include SQL or customer data here.
    return { target, status: "failed", receipt: null, remaining: steps };
  }
}

// Controlled server operations. None of these functions are HTTP handlers.
export async function purgeDueBrands(db: DatabaseConnection, input: unknown, clock = serverClock) {
  const { limit, after } = batchSchema.parse(input);
  const candidates = await new PurgeDao(db).due(clock(), limit + 1, after);
  const results: PurgeResult[] = [];
  for (const { ownerId, brandId } of candidates.slice(0, limit)) {
    results.push(await purgeBrand(db, { ownerId, brandId }, clock));
  }
  const last = candidates[limit - 1];
  return {
    results,
    next: candidates.length > limit ? { at: last.restoreUntil, id: last.brandId } : null,
  };
}

export function retryBrandPurge(db: DatabaseConnection, input: unknown, clock = serverClock) {
  return purgeBrand(db, purgeTargetSchema.parse(input), clock);
}

export async function inspectBrandPurge(db: QueryConnection, input: unknown, after?: unknown) {
  const target = purgeTargetSchema.parse(input);
  const cursor = costCursorSchema.optional().parse(after);
  const dao = new PurgeDao(db);
  const receipt = await dao.receipt(target);
  if (!receipt) return null;

  const rows = receipt.step === steps.length ? await dao.costPage(target, cursor) : [];
  const costs = rows.slice(0, purgePageSize);
  const last = costs.at(-1);
  return {
    receipt,
    remaining: steps.slice(receipt.step),
    costs,
    next: rows.length > purgePageSize && last
      ? { kind: last.kind, reservationId: last.reservationId, attemptId: last.attemptId }
      : null,
  };
}

export async function exportPurgeMarkers(db: QueryConnection, after?: unknown) {
  const rows = await new PurgeDao(db).markers(brandIdSchema.optional().parse(after));
  const markers = rows.slice(0, purgePageSize);
  return { markers, next: rows.length > purgePageSize ? markers.at(-1)?.brandId ?? null : null };
}

export async function replayBrandPurges(db: DatabaseConnection, input: unknown, clock = serverClock) {
  const results: PurgeResult[] = [];
  for (const marker of replaySchema.parse(input)) {
    const { brandId, ownerId } = marker;
    results.push(await purgeBrand(db, { brandId, ownerId }, clock, marker));
  }
  return results;
}

// The report loader must first authorize its own immutable snapshot. Supply the
// owner and brand from that snapshot, never from request parameters. Consumers
// display the evidence state outside the snapshot and keep its original bytes.
export async function readAuthorizedReportEvidence<T extends Uint8Array>(
  db: QueryConnection, target: PurgeTarget, snapshot: T,
) {
  const receipt = await new PurgeDao(db).receipt(purgeTargetSchema.parse(target));
  return { snapshot, evidence: receipt ? "no-longer-reviewable" : "unchanged" } as const;
}
