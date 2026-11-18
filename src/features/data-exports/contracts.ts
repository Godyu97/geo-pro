import { z } from "zod";
import { locales } from "../../lib/i18n/locale.ts";

export const exportScopes = ["profile", "brands"] as const;
export type ExportScope = (typeof exportScopes)[number];
export const exportIdSchema = z.uuidv4();
export const exportLocaleSchema = z.enum(locales);
export const exportRequestSchema = z.strictObject({
  actorId: z.string().min(1).max(128),
  previousId: exportIdSchema.nullable(),
  locale: exportLocaleSchema,
  scopes: z.array(z.enum(exportScopes)).min(1).max(exportScopes.length)
    .refine((scopes) => new Set(scopes).size === scopes.length),
});

export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportSummary = {
  id: string;
  locale: ExportRequest["locale"];
  createdAt: string;
  status: "ready" | "partial" | "failed";
  requested: ExportScope[];
  included: ExportScope[];
  missing: ExportScope[];
};

export const exportErrorMessage = {
  SESSION_REQUIRED: "signInRequired",
  SESSION_CHANGED: "sessionChanged",
  INVALID_INPUT: "invalidInput",
  FORBIDDEN: "forbidden",
  BRAND_SCOPE_CLOSED: "brandsClosed",
  CONFLICT: "conflict",
  NOT_FOUND: "fileUnavailable",
  SERVICE_UNAVAILABLE: "unavailable",
} as const;

export type ExportErrorCode = keyof typeof exportErrorMessage;

export function exportFileName({ locale, createdAt }: Pick<ExportSummary, "locale" | "createdAt">) {
  const label = locale === "zh-CN" ? "个人数据" : "personal-data";
  return `GeoPro-${label}-${createdAt.slice(0, 10)}.json`;
}
