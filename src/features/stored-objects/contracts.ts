import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { opaqueIdSchema } from "../maintenance/contracts.ts";

export const OBJECT_CLASSES = [
  "internal-material",
  "authorized-media",
  "delivery-package",
  "report-snapshot",
  "owned-export",
  "publication-evidence",
  "source-original",
] as const;

export const OBJECT_STATUSES = ["pending", "ready", "failed", "tombstoned"] as const;

export type ObjectClass = (typeof OBJECT_CLASSES)[number];
export type ObjectStatus = (typeof OBJECT_STATUSES)[number];
export type ObjectVisibility = "internal" | "public";

export const ACCOUNT_SCOPE = "account";
export const MAX_STORED_OBJECT_BYTES = 10 * 1024 * 1024;
export const MAX_OWNED_EXPORT_BYTES = 8 * 1024 * 1024;
export const MAX_LIST_OBJECTS = 100;

const images = ["image/jpeg", "image/png", "image/webp"] as const;

export const CONTENT_TYPES: Record<ObjectClass, readonly string[]> = {
  "internal-material": [...images, "text/plain", "text/markdown", "application/pdf", "application/json"],
  "authorized-media": images,
  "delivery-package": ["text/markdown", "text/html", "application/json"],
  "report-snapshot": ["text/html", "application/json"],
  "owned-export": ["application/json"],
  "publication-evidence": images,
  "source-original": ["text/plain", "text/markdown", "application/pdf", "application/json"],
};

const immutableClasses = new Set<ObjectClass>([
  "delivery-package",
  "report-snapshot",
  "owned-export",
  "publication-evidence",
]);

const pathSegment = /^[A-Za-z0-9_-]{1,128}$/;

export const objectClassSchema = z.enum(OBJECT_CLASSES);
export const objectVisibilitySchema = z.enum(["internal", "public"]);

export const saveStoredObjectSchema = z.strictObject({
  actorId: opaqueIdSchema,
  brandId: brandIdSchema.nullable(),
  class: objectClassSchema,
  visibility: objectVisibilitySchema,
  fileName: z.string().min(1).max(400),
  contentType: z.string().min(1).max(255),
  objectId: brandIdSchema.optional(),
});

export const readStoredObjectSchema = z.strictObject({
  actorId: opaqueIdSchema,
  objectId: brandIdSchema,
});

export const presignStoredObjectSchema = readStoredObjectSchema.extend({
  expiresInSeconds: z.number().int().min(1).max(900).optional(),
});

export const listStoredObjectsSchema = z.strictObject({
  actorId: opaqueIdSchema,
  brandId: brandIdSchema.nullable(),
  class: objectClassSchema,
  limit: z.number().int().min(1).max(MAX_LIST_OBJECTS).default(50),
});

export type SaveStoredObjectInput = z.infer<typeof saveStoredObjectSchema>;
export type ReadStoredObjectInput = z.infer<typeof readStoredObjectSchema>;
export type PresignStoredObjectInput = z.infer<typeof presignStoredObjectSchema>;
export type ListStoredObjectsInput = z.input<typeof listStoredObjectsSchema>;

export function immutableForClass(className: ObjectClass): 0 | 1 {
  return immutableClasses.has(className) ? 1 : 0;
}

export function objectByteLimit(className: ObjectClass) {
  return className === "owned-export" ? MAX_OWNED_EXPORT_BYTES : MAX_STORED_OBJECT_BYTES;
}

export function contentTypeAllowed(className: ObjectClass, contentType: string) {
  return CONTENT_TYPES[className].includes(contentType);
}

export function visibilityAllowed(className: ObjectClass, visibility: ObjectVisibility) {
  return visibility === "internal" || className === "authorized-media";
}

export function scopeAllowed(className: ObjectClass, brandId: string | null) {
  return className === "owned-export" ? brandId === null : brandId !== null;
}

export function sanitizeObjectFileName(value: string) {
  const base = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const cleaned = base.replaceAll("..", "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length < 1 || [...cleaned].length > 120) return undefined;
  if (cleaned === "." || cleaned.includes("/") || cleaned.includes("\\") || cleaned.includes("..")) return undefined;
  return cleaned;
}

export function buildObjectKey(input: {
  ownerId: string;
  brandId: string | null;
  class: ObjectClass;
  objectId: string;
  fileName: string;
}) {
  const scopeId = input.brandId ?? ACCOUNT_SCOPE;
  const segments = [input.ownerId, scopeId, input.class, input.objectId];
  if (segments.some((segment) => !pathSegment.test(segment))) return undefined;
  if (sanitizeObjectFileName(input.fileName) !== input.fileName) return undefined;
  return `v1/${segments.join("/")}/${input.fileName}`;
}
