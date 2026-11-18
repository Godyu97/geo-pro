import { z } from "zod";
import { brandIdSchema as id } from "../brands/contracts.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";

const text = (limit: number) => z.string().max(limit).refine((value) => !/[\u0000\uD800-\uDFFF]/u.test(value));
export const pasteLimit = 20_000;
const original = text(pasteLimit * 2).refine((value) => !!value.trim() && Array.from(value).length <= pasteLimit);
export const factCategory = z.enum(["positioning", "specification", "price", "region", "qualification", "boundary"]);
export const factStage = z.enum(["review", "delivery", "published", "history"]);
export const timestamp = z.iso.datetime({ precision: 3 });
const revision = z.number().int().positive();
const date = z.iso.date().refine((value) => value > "0000-12-31" && value < "9999-12-31");

export const factFields = z.strictObject({
  category: factCategory,
  title: text(120).trim(),
  claim: text(4_000).trim(),
  sourceType: z.enum(["url", "material", "internal"]),
  sourceReference: text(1_000).trim(),
  sourceLocator: text(500).trim(),
  sourceExcerpt: text(4_000).trim(),
  sourceDate: z.union([date, z.literal("")]),
  permission: z.enum(["unknown", "public", "private"]),
  validity: z.enum(["unspecified", "dated", "longTerm"]),
  validThrough: z.union([date, z.literal("")]),
  pasteId: id.nullable(),
  pasteSpan: z.tuple([z.number().int().nonnegative().max(pasteLimit * 2), z.number().int().positive().max(pasteLimit * 2)]).nullable(),
}).refine(({ pasteId, pasteSpan }) => !pasteSpan || (pasteId !== null && pasteSpan[0] < pasteSpan[1]));

export const factCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("savePaste"), id, previousId: id.nullable(), original }),
  z.strictObject({ action: z.literal("create"), id, previousId: id.nullable(), fields: factFields }),
  z.strictObject({ action: z.literal("edit"), id, revision, fields: factFields }),
  z.strictObject({ action: z.literal("submit"), id, revision }),
  z.strictObject({ action: z.literal("approve"), id, revision, confirmed: z.literal(true),
    conflictId: id.nullable(), revokeConflict: z.boolean() }),
  z.strictObject({ action: z.literal("revoke"), id, revision, confirmed: z.literal(true) }),
]);

export const versionRow = z.object({
  id, factId: id, version: revision, entityVersion: revision, revision,
  state: z.enum(["draft", "pending_confirmation", "approved", "revoked"]),
  content: z.string(),
  createdAt: timestamp,
  confirmedBy: opaqueIdSchema.nullable(),
  confirmedAt: timestamp.nullable(),
  revokedAt: timestamp.nullable(),
});

export const pasteRow = z.object({ id, previousId: id.nullable(), original, createdAt: timestamp });
export const cursorSchema = z.object({ at: timestamp, id });
export const factScope = z.strictObject({ ownerId: opaqueIdSchema, brandId: id });
export const factIdsSchema = z.array(id).min(1).max(100).refine((ids) => new Set(ids).size === ids.length);

export type FactScope = z.infer<typeof factScope>;
export type FactStage = z.infer<typeof factStage>;
export type FactFields = z.infer<typeof factFields>;
export type FactCommand = z.infer<typeof factCommand>;
export type FactVersion = Omit<z.infer<typeof versionRow>, "content"> & { fields: FactFields };
export type FactPaste = z.infer<typeof pasteRow>;
export type FactCursor = z.infer<typeof cursorSchema>;
