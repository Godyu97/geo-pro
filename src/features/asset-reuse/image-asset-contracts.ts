import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const IMAGE_RIGHTS = ["active", "revoked", "expired"] as const;
export type ImageRights = (typeof IMAGE_RIGHTS)[number];

export const imageAssetLimit = 50;
export const imageAssetUseLimit = 100;

export const imageAssetErrors = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  RIGHTS_CLOSED: 409,
} as const;

export type ImageAssetError = keyof typeof imageAssetErrors;

const fileNameSchema = z.string().trim().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 120
    && value.isWellFormed()
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("..")
    && !/[\u0000-\u001f\u007f]/.test(value);
});

const versionSchema = z.number().int().min(1).max(2_147_483_647);
const byteSizeSchema = z.number().int().min(0).max(2_147_483_647).nullable();

export const registerImageAssetSchema = z.strictObject({
  brandId: brandIdSchema,
  fileName: fileNameSchema,
  version: versionSchema.optional(),
  byteSize: byteSizeSchema.optional(),
});

export const registerImageAssetUseSchema = z.strictObject({
  brandId: brandIdSchema,
  id: brandIdSchema,
  contentVersionId: brandIdSchema,
});

export const registerImageAssetUseBodySchema = registerImageAssetUseSchema.omit({ id: true });

export const readImageAssetSchema = z.strictObject({
  brandId: brandIdSchema,
  id: brandIdSchema,
});

export const revokeImageAssetSchema = readImageAssetSchema;
export const expireImageAssetSchema = readImageAssetSchema;

export type RegisterImageAssetInput = z.infer<typeof registerImageAssetSchema>;
export type RegisterImageAssetUseInput = z.infer<typeof registerImageAssetUseSchema>;
export type ReadImageAssetInput = z.infer<typeof readImageAssetSchema>;

export type ImageAssetView = {
  id: string;
  fileName: string;
  version: number;
  rightsStatus: ImageRights;
  byteSize: number | null;
  createdAt: string;
};

export type ImageAssetUseView = {
  id: string;
  contentVersionId: string;
  assetVersion: number;
  createdAt: string;
  supersededAt?: string;
};

export type ImageAssetTodoView = {
  id: string;
  useId: string;
  contentVersionId: string;
  assetVersion: number;
  createdAt: string;
};

export type ImageAssetDetail = {
  asset: ImageAssetView;
  uses: ImageAssetUseView[];
  todos: ImageAssetTodoView[];
};

export type ImageAssetList = { assets: ImageAssetDetail[] } | { error: "NOT_FOUND" };

export type ImageAssetRead = ImageAssetDetail | { error: "NOT_FOUND" };

export type ImageAssetRegistration = { asset: ImageAssetView } | { error: "NOT_FOUND" | "INVALID_INPUT" };

export type ImageAssetUseRegistration =
  | { use: ImageAssetUseView }
  | { error: "NOT_FOUND" | "RIGHTS_CLOSED" };

export type ImageAssetRevocation = ImageAssetDetail | { error: "NOT_FOUND" };

export type ImageAssetExpiry = ImageAssetDetail | { error: "NOT_FOUND" };
