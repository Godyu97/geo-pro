import { z } from "zod";
import { isTimeZone, windowBounds } from "../sampling-plans/due-window.ts";

const day = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });

const savedWindows = z.object({
  before: z.object({ start: day, endExclusive: day }),
  after: z.object({ start: day, endExclusive: day }),
});

const savedRecord = z.object({
  source: z.literal("saved-observations"),
  windows: savedWindows,
});

export type SavedWindows = z.infer<typeof savedWindows>;

export function windowInstant(value: string, timezone: string) {
  if (day.safeParse(value).success) return Date.parse(windowBounds(value, timezone)?.start ?? "");
  return timestamp.safeParse(value).success ? Date.parse(value) : NaN;
}

export function orderedWindowBounds(windows: SavedWindows, timezone: string) {
  if (!isTimeZone(timezone)) return { error: "INVALID_INPUT" as const };
  const before = {
    start: windowInstant(windows.before.start, timezone),
    endExclusive: windowInstant(windows.before.endExclusive, timezone),
  };
  const after = {
    start: windowInstant(windows.after.start, timezone),
    endExclusive: windowInstant(windows.after.endExclusive, timezone),
  };
  if (!(before.start < before.endExclusive && after.start < after.endExclusive)) {
    return { error: "INVALID_INPUT" as const };
  }
  if (before.endExclusive > after.start) return { error: "WINDOWS_NOT_ORDERED" as const };
  return { before, after };
}

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
