export type SamplingSlotStatus = "scheduled" | "completed" | "failed" | "paused";

export type SamplingSlot = {
  id: string;
  channelId: string;
  at: string;
  status: SamplingSlotStatus;
  manual: boolean;
};

export function coverageDenominator(slots: readonly SamplingSlot[]) {
  return slots.filter((slot) => slot.status === "completed" || slot.status === "failed");
}

/** Pause only future scheduled slots when the next window has no remaining budget. Past failures stay. */
export function pauseUnfundedSlots(
  slots: readonly SamplingSlot[],
  input: { spentMinor: number; pendingMinor: number; budgetMinor: number; nextAt: string },
) {
  const remaining = input.budgetMinor - input.spentMinor - input.pendingMinor;
  if (remaining > 0) return { slots: [...slots], pausedIds: [] as string[] };
  const pausedIds: string[] = [];
  const next = slots.map((slot) => {
    if (slot.status === "scheduled" && slot.at >= input.nextAt) {
      pausedIds.push(slot.id);
      return { ...slot, status: "paused" as const };
    }
    return slot;
  });
  return { slots: next, pausedIds };
}

/** An expired channel pauses only its own future slots. Other channels are not replaced. */
export function pauseIneligibleChannel(
  slots: readonly SamplingSlot[],
  input: { channelId: string; nextAt: string },
) {
  return slots.map((slot) => (
    slot.channelId === input.channelId && slot.status === "scheduled" && slot.at >= input.nextAt
      ? { ...slot, status: "paused" as const }
      : slot
  ));
}
