import { z } from "zod";
import { opaqueIdSchema } from "../maintenance/contracts.ts";

export const brandIdSchema = z.uuidv4();
const revisionSchema = z.number().int().positive().max(2_147_483_647);
export const brandStatusSchema = z.enum(["active", "archived"]);
export const brandStepSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export const brandVersionParam = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(revisionSchema);

function field(min: number, max: number) {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= min && length <= max && value.isWellFormed() && !value.includes("\0");
  });
}

function publicHttpUrl(value: string) {
  if (!value) return true;
  if (!/^https?:\/\//i.test(value) || /[\\\s\p{Cc}]/u.test(value)) return false;
  const url = URL.parse(value);
  if (!url || url.username || url.password || !["http:", "https:"].includes(url.protocol)) return false;

  // Accept public DNS names. Literal addresses, local DNS and reserved suffixes
  // cannot identify a public brand website in this release. Do not fetch it.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(host) &&
    !/\.(?:example|internal|invalid|lan|local|localhost|onion|test)$/.test(host) &&
    !host.endsWith(".home.arpa");
}

function canonicalLanguage(value: string) {
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

export const brandDraftFieldsSchema = z.strictObject({
  name: field(0, 80),
  description: field(0, 300),
  website: field(0, 2048),
  aliases: z.array(field(1, 80)).max(10),
  region: field(0, 12),
  language: field(0, 40),
  competitors: z.array(field(1, 80)).max(3),
  questions: z.array(field(1, 500)).max(10),
});

export const brandFieldsSchema = brandDraftFieldsSchema.extend({
  name: field(2, 80),
  description: field(5, 300),
  website: brandDraftFieldsSchema.shape.website.refine(publicHttpUrl),
  region: field(2, 2).regex(/^[a-z]{2}$/i).transform((value) => value.toUpperCase()),
  language: field(2, 40).transform((value, ctx) => {
    const canonical = canonicalLanguage(value);
    if (canonical) return canonical;
    ctx.addIssue({ code: "custom", message: "Invalid business language" });
    return z.NEVER;
  }),
});

export type BrandFields = z.infer<typeof brandFieldsSchema>;
export type BrandStep = z.infer<typeof brandStepSchema>;
export const initialBrandFields: BrandFields = {
  name: "", description: "", website: "", aliases: [],
  region: "CN", language: "zh-CN", competitors: [], questions: [],
};

const targetSchema = z.strictObject({
  brandId: brandIdSchema,
  expectedBrandRevision: revisionSchema,
}).nullable();

const writeIdentity = {
  operationId: brandIdSchema,
  actorId: z.string().min(1).max(128),
};

const draftInput = {
  ...writeIdentity,
  target: targetSchema,
  expectedDraft: brandIdSchema.nullable(),
};

const statusInput = { ...writeIdentity, brandId: brandIdSchema, expectedBrandRevision: revisionSchema };
export const brandDeadlineSchema = z.strictObject({
  brandId: brandIdSchema,
  ownerId: opaqueIdSchema,
  operatorId: opaqueIdSchema,
  requestId: brandIdSchema,
  expectedBrandRevision: revisionSchema,
  restoreUntil: z.iso.datetime({ precision: 3 }),
});

export const brandCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("saveDraft"), ...draftInput, fields: brandDraftFieldsSchema, step: brandStepSchema }),
  z.strictObject({ action: z.literal("submit"), ...draftInput, fields: brandFieldsSchema }),
  z.strictObject({ action: z.literal("discardDraft"), ...writeIdentity, brandId: brandIdSchema.nullable(), expectedDraft: brandIdSchema }),
  z.strictObject({ action: z.literal("archive"), ...statusInput }),
  z.strictObject({ action: z.literal("restore"), ...statusInput }),
  z.strictObject({ action: z.literal("freeze"), ...statusInput, confirmed: z.literal(true) }),
  z.strictObject({ action: z.literal("recover"), ...statusInput }),
]);

export type BrandCommand = z.infer<typeof brandCommandSchema>;
export type BrandCommandInput = z.input<typeof brandCommandSchema>;
export type BrandTarget = NonNullable<z.infer<typeof targetSchema>>;

export const brandMutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draft"), version: brandIdSchema.nullable() }),
  z.object({
    kind: z.literal("brand"), id: brandIdSchema, status: brandStatusSchema,
    revision: revisionSchema, entityVersion: revisionSchema,
  }),
  z.object({
    kind: z.literal("deletion"), id: brandIdSchema, revision: revisionSchema,
    restoreUntil: z.iso.datetime().nullable(), operatorId: opaqueIdSchema.optional(),
  }),
]);
export type BrandMutation = z.infer<typeof brandMutationSchema>;

export const archiveCursorSchema = z.strictObject({ at: z.iso.datetime(), id: brandIdSchema });
export type ArchiveCursor = z.infer<typeof archiveCursorSchema>;

export const brandFieldNameSchema = z.enum(["name", "description", "website", "aliases", "region", "language", "competitors", "questions"]);
export type BrandFieldName = z.infer<typeof brandFieldNameSchema>;

export const brandErrorCodeSchema = z.enum([
  "SESSION_REQUIRED", "SESSION_CHANGED", "NOT_FOUND", "LIMIT_REACHED", "VERSION_CONFLICT", "OPERATION_CONFLICT",
  "INTAKE_CLOSED", "DEV_ACTOR_DENIED", "INVALID_INPUT", "FORBIDDEN", "SERVICE_UNAVAILABLE",
  "IDENTITY_UNVERIFIED", "REAUTH_REQUIRED", "RECOVERY_EXPIRED",
]);
export type BrandErrorCode = z.infer<typeof brandErrorCodeSchema>;
