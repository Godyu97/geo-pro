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

export type PlanPhase = "draft" | "active" | "paused" | "ended";

const planTransitions: Record<PlanPhase, readonly PlanPhase[]> = {
  draft: ["active"],
  active: ["paused", "ended"],
  paused: ["active", "ended"],
  ended: [],
};

export function transitionPlan(phase: PlanPhase, next: PlanPhase) {
  return planTransitions[phase].includes(next) ? next : null;
}

/** Budget edits create a new plan version and keep failed slot ids in the coverage record. */
export function reviseBudget(plan: {
  version: number;
  phase: PlanPhase;
  budgetMinor: number;
  failedSlotIds: readonly string[];
}, budgetMinor: number) {
  return {
    version: plan.version + 1,
    phase: plan.phase,
    budgetMinor,
    failedSlotIds: [...plan.failedSlotIds],
  };
}

/** Pause future slots when the next unit costs more than the budget still available, including pending reconciliation. */
export function pauseUnaffordableSlots(
  slots: readonly SamplingSlot[],
  input: { spentMinor: number; pendingMinor: number; budgetMinor: number; nextAt: string; slotCostMinor: number },
) {
  const remaining = input.budgetMinor - input.spentMinor - input.pendingMinor;
  const pausedIds: string[] = [];
  if (input.slotCostMinor < 0 || remaining >= input.slotCostMinor) {
    return { slots: [...slots], pausedIds, remaining };
  }
  const next = slots.map((slot) => {
    if (slot.status === "scheduled" && slot.at >= input.nextAt) {
      pausedIds.push(slot.id);
      return { ...slot, status: "paused" as const };
    }
    return slot;
  });
  return { slots: next, pausedIds, remaining };
}

export const manualSheetQuestionLimit = 10;

/** Consumer sheets are manual work. They never claim the consumer channel was collected automatically. */
export function consumerSheet(promptIds: readonly string[]) {
  return {
    execution: "manual" as const,
    automaticCollection: false as const,
    promptIds: [...promptIds],
  };
}

export type ManualSheetLine = {
  id: string;
  text: string | null;
  missing: boolean;
};

/** Keep the saved sheet order. An id with no frozen text stays listed and is not replaced. */
export function manualSheetLines(promptIds: readonly string[], savedTexts: ReadonlyMap<string, string>) {
  const sheet = consumerSheet(promptIds);
  return {
    execution: sheet.execution,
    automaticCollection: sheet.automaticCollection,
    lines: sheet.promptIds.map((id) => {
      const text = savedTexts.get(id);
      return text === undefined
        ? { id, text: null, missing: true }
        : { id, text, missing: false };
    }),
  };
}
