import { z } from "zod";
import { brandPurgeSteps } from "../brands/purge-steps.ts";
import { capabilityStatuses } from "../capabilities/contracts.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";
import { runStatuses } from "../monitoring/contracts.ts";

export { brandPurgeSteps as deletionSteps };

export const supportQuerySchema = z.strictObject({ operationId: opaqueIdSchema });
export const supportFailures = [
  "none", "cost-unknown", "partial-failure", "deletion-incomplete", "deletion-frozen",
  "channel-degraded", "channel-disabled",
] as const;
export const supportRecoveries = [
  "none", "monitoring.reconcile", "brands.purge.retry", "owner.recover", "capabilities.review",
] as const;
const subjectSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const supportMatchSchema = z.strictObject({
  kind: z.enum(["monitoring-run", "brand-deletion", "capability"]),
  subjectId: subjectSchema,
  status: z.enum([...runStatuses, "cleared", "incomplete", "frozen", ...capabilityStatuses]),
  failure: z.enum(supportFailures),
  reconciliation: z.enum(["required", "clear"]),
  remaining: z.array(subjectSchema).max(50),
  recovery: z.enum(supportRecoveries),
});
export const supportViewSchema = z.strictObject({
  matches: z.array(supportMatchSchema).max(8),
});
export type SupportView = z.infer<typeof supportViewSchema>;
export type SupportMatch = z.infer<typeof supportMatchSchema>;

export const supportCacheStates = ["origin", "hit", "blocked"] as const;
export type SupportCacheState = (typeof supportCacheStates)[number];
