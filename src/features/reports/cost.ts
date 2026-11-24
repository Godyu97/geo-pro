import { z } from "zod";

export type CostWindow = { start: string; endExclusive: string };

export type CostWindows = {
  before: CostWindow;
  after: CostWindow;
};

const minor = z.preprocess((value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return value;
}, z.number().int().nonnegative().nullable());

const attemptCount = z.preprocess((value) => {
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return value;
}, z.number().int().positive());

export const costGroupRow = z.object({
  costState: z.enum(["known", "pending", "unknown"]),
  currency: z.string().length(3).nullable(),
  actualMinor: minor,
  attemptCount,
});

export type CostGroup = z.infer<typeof costGroupRow>;

export const snapshotCostSchema = z.union([
  z.strictObject({
    status: z.literal("not_applicable"),
    reason: z.literal("no_sampling_cost"),
  }),
  z.strictObject({
    status: z.literal("summarized"),
    known: z.array(z.strictObject({
      currency: z.string().length(3),
      minor: z.number().int().nonnegative(),
    })).max(20),
    pending_count: z.number().int().nonnegative(),
  }),
]);

export const snapshotLaborSchema = z.strictObject({
  status: z.literal("not_applicable"),
  reason: z.literal("unrecorded"),
});

export type SnapshotCost = z.infer<typeof snapshotCostSchema>;
export type SnapshotLabor = z.infer<typeof snapshotLaborSchema>;

export const unrecordedLabor: SnapshotLabor = { status: "not_applicable", reason: "unrecorded" };

const notApplicableCost: SnapshotCost = { status: "not_applicable", reason: "no_sampling_cost" };

/** Sum known sampling fees by currency. Pending and unknown stay a count, never a zero fee. */
export function summarizeCostGroups(groups: readonly CostGroup[]): SnapshotCost {
  let pending = 0;
  const known = new Map<string, number>();
  for (const group of groups) {
    if (group.costState === "known" && group.currency && group.actualMinor != null) {
      known.set(group.currency, (known.get(group.currency) ?? 0) + group.actualMinor);
      continue;
    }
    pending += group.attemptCount;
  }
  if (known.size === 0 && pending === 0) return notApplicableCost;
  return {
    status: "summarized",
    known: [...known.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amount]) => ({ currency, minor: amount })),
    pending_count: pending,
  };
}

/**
 * One grouped read of sampling attempts on this brand's runs.
 * The outer created_at bounds can use monitoring_attempt_brand_idx; the inner
 * predicate keeps attempts that fall in the before or after window only.
 * `none` and analysis rows are excluded, so a free attempt is not stored as zero.
 */
export function samplingCostGroupsQuery(brandId: string, windows: CostWindows) {
  const lower = windows.before.start < windows.after.start ? windows.before.start : windows.after.start;
  const upper = windows.before.endExclusive > windows.after.endExclusive
    ? windows.before.endExclusive
    : windows.after.endExclusive;
  return {
    sql: `SELECT a.cost_state AS "costState", a.currency AS "currency",
      SUM(a.actual_minor) AS "actualMinor", COUNT(*) AS "attemptCount"
    FROM monitoring_attempt a
    INNER JOIN monitoring_run r ON r.id = a.run_id AND r.brand_id = a.brand_id
    WHERE a.brand_id = ?
      AND a.kind = 'sampling'
      AND a.cost_state IN ('known', 'pending', 'unknown')
      AND a.created_at >= ? AND a.created_at < ?
      AND (
        (a.created_at >= ? AND a.created_at < ?)
        OR (a.created_at >= ? AND a.created_at < ?)
      )
    GROUP BY a.cost_state, a.currency`,
    values: [
      brandId,
      lower,
      upper,
      windows.before.start,
      windows.before.endExclusive,
      windows.after.start,
      windows.after.endExclusive,
    ],
  };
}
