import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const savedWindows = z.object({
  before: z.object({ start: day, endExclusive: day }),
  after: z.object({ start: day, endExclusive: day }),
});

const savedRecord = z.object({
  source: z.literal("saved-observations"),
  windows: savedWindows,
});

export type SavedWindows = z.infer<typeof savedWindows>;

/** Brand-scoped observation ids. The caller supplies the window instants; ids are not taken from a form. */
export function windowObservationsQuery(
  ownerId: string,
  brandId: string,
  track: string,
  start: string,
  endExclusive: string,
) {
  return {
    sql: `SELECT o.id AS "id" FROM answer_observation o
      WHERE o.owner_id = ? AND o.brand_id = ? AND o.source_mode = ?
        AND o.captured_at >= ? AND o.captured_at < ?
      LIMIT 501`,
    values: [ownerId, brandId, track, start, endExclusive],
  };
}

export function readSavedWindows(comparisonJson: string | null): SavedWindows | null {
  if (!comparisonJson) return null;
  try {
    const parsed = savedRecord.safeParse(JSON.parse(comparisonJson));
    return parsed.success ? parsed.data.windows : null;
  } catch {
    return null;
  }
}

const progressRecord = z.object({
  elapsedFullDays: z.number().int().nonnegative(),
  remainingFullDays: z.number().int().nonnegative(),
  autoCharge: z.literal(false),
});

export function readTodoProgress(progressJson: string) {
  try {
    const parsed = progressRecord.safeParse(JSON.parse(progressJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
