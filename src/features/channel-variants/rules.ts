export type Variant = { id: string; channel: string; approved: boolean; body: string };

export function variantNeedsOwnApproval(masterApproved: boolean, variant: Variant, masterBody: string) {
  if (!masterApproved) return true;
  return variant.body !== masterBody || !variant.approved;
}

export function maintenanceQueue(input: { factId: string; pageIds: readonly string[] }) {
  const pages = [...new Set(input.pageIds)];
  return { factId: input.factId, pages, taskCount: pages.length === 0 ? 0 : 1 };
}

export function calendarRow(input: { plannedOn: string | null; verifiedOn: string | null; blocked: boolean }) {
  return {
    plannedOn: input.plannedOn,
    verifiedOn: input.verifiedOn,
    published: Boolean(input.verifiedOn),
    blocked: input.blocked,
  };
}
