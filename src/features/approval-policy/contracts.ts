import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";

export const approvalKinds = ["fact", "content"] as const;
export const approvalAttemptReasons = ["separation", "duty"] as const;
export const approvalBrandLimit = 50;
export const approvalDutyLimit = 40;

export const approvalErrors = {
  SESSION_REQUIRED: 401,
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  DUTY: 403,
  NOT_FOUND: 404,
  SEPARATION: 409,
  FACT_INVALID: 422,
  OPERATION_CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
} as const;

const dutyInputSchema = z.strictObject({
  userId: opaqueIdSchema,
  factApprover: z.boolean(),
  contentApprover: z.boolean(),
}).refine((duty) => duty.factApprover || duty.contentApprover);

export const saveApprovalPolicySchema = z.strictObject({
  brandId: brandIdSchema,
  dualControl: z.boolean(),
  duties: z.array(dutyInputSchema).max(approvalDutyLimit),
}).refine((input) => new Set(input.duties.map((duty) => duty.userId)).size === input.duties.length);

export const decideApprovalSchema = z.strictObject({
  brandId: brandIdSchema,
  versionId: brandIdSchema,
  kind: z.enum(approvalKinds),
});

export type ApprovalKind = (typeof approvalKinds)[number];
export type ApprovalAttemptReason = (typeof approvalAttemptReasons)[number];
export type ApprovalError = keyof typeof approvalErrors;
export type SaveApprovalPolicyInput = z.infer<typeof saveApprovalPolicySchema>;
export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;

export type ApprovalDutyView = {
  userId: string;
  factApprover: boolean;
  contentApprover: boolean;
};

export type ApprovalPolicyView = {
  brandId: string;
  version: number;
  dualControl: boolean;
  duties: ApprovalDutyView[];
};

export type ApprovalPolicyList = {
  policies: ApprovalPolicyView[];
};

export type ApprovalDecision =
  | {
    kind: ApprovalKind;
    versionId: string;
    status: "approved";
    replayed: boolean;
    approvalId?: string;
  }
  | {
    error: ApprovalError;
    versionId?: string;
    reason?: ApprovalAttemptReason;
  };
