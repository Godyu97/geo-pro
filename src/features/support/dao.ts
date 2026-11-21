import "server-only";

import { z } from "zod";
import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import { brandPurgeIssues, brandPurgeSteps } from "../brands/purge-steps.ts";
import { capabilityStatuses } from "../capabilities/contracts.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";
import { runStatuses, slotStatuses } from "../monitoring/contracts.ts";
import { deletionSteps, type SupportMatch } from "./contracts.ts";

const runSchema = z.object({
  id: opaqueIdSchema,
  operationId: opaqueIdSchema,
  status: z.enum(runStatuses),
});
const slotSchema = z.object({
  id: opaqueIdSchema,
  runId: opaqueIdSchema,
  status: z.enum(slotStatuses),
});
const attemptSchema = z.object({
  id: opaqueIdSchema,
  runId: opaqueIdSchema,
  slotId: opaqueIdSchema,
  costState: z.enum(["none", "pending", "known", "unknown"]),
});
const purgeSchema = z.object({
  brandId: opaqueIdSchema,
  step: z.int().min(0).max(brandPurgeSteps.length),
  issue: z.enum(brandPurgeIssues).nullable(),
});
const frozenSchema = z.object({
  id: opaqueIdSchema,
  restoreUntil: z.iso.datetime({ precision: 3 }).nullable(),
});
const capabilitySchema = z.object({
  channelId: opaqueIdSchema,
  version: z.int().positive(),
  status: z.enum(capabilityStatuses),
});

const finished = new Set(["succeeded", "cancelled"]);

export class SupportDao {
  private readonly connection: QueryConnection;

  constructor(connection: QueryConnection) {
    this.connection = connection;
  }

  private query(sql: string, values: QueryValue[]) {
    return queryWithParameters(this.connection, sql, values);
  }

  async locate(operationId: string, now: string): Promise<SupportMatch[]> {
    const id = opaqueIdSchema.parse(operationId);
    const [byId, byOperation, attempt, purgeRows, frozenRows, capabilityByOperation, capabilityByChannel] = await Promise.all([
      this.query(`SELECT id, operation_id AS "operationId", status FROM monitoring_run WHERE id = ?`, [id]),
      this.query(`SELECT id, operation_id AS "operationId", status FROM monitoring_run WHERE operation_id = ? LIMIT 5`, [id]),
      this.query(`SELECT id, run_id AS "runId", slot_id AS "slotId", cost_state AS "costState" FROM monitoring_attempt WHERE id = ?`, [id]),
      this.query(`SELECT brand_id AS "brandId", step, issue FROM brand_purge WHERE brand_id = ?`, [id]),
      this.query(`SELECT id, restore_until AS "restoreUntil" FROM brand WHERE id = ? AND frozen_at IS NOT NULL`, [id]),
      this.query(`SELECT channel_id AS "channelId", version, status FROM capability_version WHERE operation_id = ?`, [id]),
      this.query(`SELECT channel_id AS "channelId", version, status FROM capability_version WHERE channel_id = ? ORDER BY version DESC LIMIT 1`, [id]),
    ]);

    const runs = z.array(runSchema).parse([...byId, ...byOperation]);
    const directAttempt = z.array(attemptSchema).parse(attempt)[0] ?? null;
    const known = new Set(runs.map((run) => run.id));
    if (directAttempt && !known.has(directAttempt.runId)) {
      const extra = await this.query(`SELECT id, operation_id AS "operationId", status FROM monitoring_run WHERE id = ?`, [directAttempt.runId]);
      runs.push(...z.array(runSchema).parse(extra));
    }
    const runIds = [...new Set(runs.map((run) => run.id))].sort();
    const [slotRows, attemptRows] = runIds.length
      ? await Promise.all([
        this.query(`SELECT id, run_id AS "runId", status FROM monitoring_slot WHERE run_id IN (${runIds.map(() => "?").join(", ")}) ORDER BY id`, runIds),
        this.query(`SELECT id, run_id AS "runId", slot_id AS "slotId", cost_state AS "costState" FROM monitoring_attempt WHERE kind = 'sampling' AND run_id IN (${runIds.map(() => "?").join(", ")}) ORDER BY id`, runIds),
      ])
      : [[], []];
    const slots = z.array(slotSchema).parse(slotRows);
    const attempts = z.array(attemptSchema).parse(attemptRows);
    const matches: SupportMatch[] = [];
    const seen = new Set<string>();
    for (const run of runs) {
      if (seen.has(run.id)) continue;
      seen.add(run.id);
      const runSlots = slots.filter((slot) => slot.runId === run.id);
      const runAttempts = attempts.filter((item) => item.runId === run.id);
      const unknown = runAttempts.some((item) => item.costState === "unknown")
        || runSlots.some((slot) => slot.status === "reconciliation_required");
      const remaining = runSlots.filter((slot) => !finished.has(slot.status)).map((slot) => slot.id).slice(0, 50);
      const partial = remaining.length > 0 && (run.status === "partial" || run.status === "failed");
      matches.push({
        kind: "monitoring-run",
        subjectId: run.id,
        status: run.status,
        failure: unknown ? "cost-unknown" : partial ? "partial-failure" : "none",
        reconciliation: unknown ? "required" : "clear",
        remaining,
        recovery: unknown || partial ? "monitoring.reconcile" : "none",
      });
    }

    const purge = z.array(purgeSchema).parse(purgeRows)[0];
    if (purge) {
      const remaining = deletionSteps.slice(purge.step);
      const cleared = purge.step === deletionSteps.length;
      matches.push({
        kind: "brand-deletion",
        subjectId: purge.brandId,
        status: cleared ? "cleared" : "incomplete",
        failure: cleared ? "none" : "deletion-incomplete",
        reconciliation: purge.issue === "unresolved-costs" ? "required" : "clear",
        remaining: cleared ? [] : [...remaining],
        recovery: cleared ? "none" : "brands.purge.retry",
      });
    } else {
      const frozen = z.array(frozenSchema).parse(frozenRows)[0];
      if (frozen) {
        const due = Boolean(frozen.restoreUntil && frozen.restoreUntil <= now);
        matches.push({
          kind: "brand-deletion",
          subjectId: frozen.id,
          status: "frozen",
          failure: "deletion-frozen",
          reconciliation: "clear",
          remaining: [...deletionSteps],
          recovery: due ? "brands.purge.retry" : "owner.recover",
        });
      }
    }

    const capabilities = z.array(capabilitySchema).parse([...capabilityByOperation, ...capabilityByChannel]);
    const seenCapability = new Set<string>();
    for (const version of capabilities) {
      const key = `${version.channelId}:${version.version}`;
      if (seenCapability.has(key)) continue;
      seenCapability.add(key);
      const failure = version.status === "degraded" ? "channel-degraded" : version.status === "disabled" ? "channel-disabled" : "none";
      matches.push({
        kind: "capability",
        subjectId: version.channelId,
        status: version.status,
        failure,
        reconciliation: "clear",
        remaining: failure === "none" ? [] : [version.channelId],
        recovery: failure === "none" ? "none" : "capabilities.review",
      });
    }
    return matches.slice(0, 8);
  }
}
