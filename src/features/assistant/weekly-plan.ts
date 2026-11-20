export type PlanItem = { id: string; factCurrent: boolean };

/** Text inside collected material cannot change budget, grants, or the action list. */
export function draftPlan(input: { material: string; requestedItems: readonly string[] }) {
  const items = input.requestedItems.slice(0, 5);
  return {
    items,
    ignoredInstruction: input.material.includes("忽略预算") || input.material.includes("公开发文"),
    budgetChanged: false,
    grantsChanged: false,
  };
}

export function executeConfirmed(input: { confirmedIds: readonly string[]; items: readonly PlanItem[] }) {
  const confirmed = new Set(input.confirmedIds);
  return input.items
    .filter((item) => confirmed.has(item.id))
    .map((item) => ({ id: item.id, status: item.factCurrent ? "execute" as const : "blocked" as const }));
}

export function saveStrategy(input: { successes: number }) {
  return {
    label: "observation" as const,
    guaranteed: false,
    successes: input.successes,
  };
}
