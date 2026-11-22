import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const TEMPLATE_STATUSES = ["draft", "published", "retired"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const contentTemplateLimit = 100;

export const templateErrors = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  GATE_REQUIRED: 409,
  SYSTEM_READONLY: 409,
} as const;

export type TemplateError = keyof typeof templateErrors;

const templateName = z.string().trim().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 120 && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
});

const gatesSchema = z.strictObject({
  fact: z.boolean(),
  publicLicense: z.boolean(),
  review: z.boolean(),
});

export const cloneContentTemplateSchema = z.strictObject({
  brandId: brandIdSchema,
  id: brandIdSchema,
  gates: gatesSchema,
  name: templateName.optional(),
});

export const cloneContentTemplateBodySchema = cloneContentTemplateSchema.omit({ id: true });

export const exportContentTemplateSchema = z.strictObject({
  brandId: brandIdSchema,
  id: brandIdSchema,
});

export const exportContentTemplateBodySchema = exportContentTemplateSchema.omit({ id: true });

export const updateContentTemplateSchema = z.strictObject({
  brandId: brandIdSchema,
  id: brandIdSchema,
  name: templateName,
  status: z.enum(TEMPLATE_STATUSES),
  gates: gatesSchema,
});

export const updateContentTemplateBodySchema = updateContentTemplateSchema.omit({ id: true });

export type CloneContentTemplateInput = z.infer<typeof cloneContentTemplateSchema>;
export type ExportContentTemplateInput = z.infer<typeof exportContentTemplateSchema>;
export type UpdateContentTemplateInput = z.infer<typeof updateContentTemplateSchema>;

export type TemplateView = {
  id: string;
  name: string;
  system: boolean;
  status: TemplateStatus;
  asksToInventCaseStudy: boolean;
  gates: { fact: boolean; publicLicense: boolean; review: boolean };
  sourceTemplateId: string | null;
  readOnly: boolean;
};

export type TemplateList = { templates: TemplateView[] } | { error: "NOT_FOUND" };

export type TemplateClone =
  | { template: TemplateView; readOnlySource: boolean }
  | { error: "NOT_FOUND" | "GATE_REQUIRED"; reason?: "gate_required" };

export type TemplateExport =
  | { allowed: false; reason: "fact_gate" | "approval_gate" }
  | { error: "NOT_FOUND" };

export type TemplateUpdate =
  | { template: TemplateView }
  | { error: "NOT_FOUND" | "GATE_REQUIRED" | "SYSTEM_READONLY"; reason?: "gate_required" };
