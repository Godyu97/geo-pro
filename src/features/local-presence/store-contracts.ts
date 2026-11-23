import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const brandStoreListLimit = 50;
export const storeFactUseListLimit = 50;

function boundedText(max: number) {
  return z.string().trim().refine((value) => {
    const length = [...value].length;
    return length >= 1 && length <= max && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
  });
}

export const storeNameSchema = boundedText(80);
export const serviceAreaSchema = boundedText(160);

export const registerBrandStoreSchema = z.strictObject({
  brandId: brandIdSchema,
  name: storeNameSchema,
  serviceArea: serviceAreaSchema,
});

export const recordStoreFactUseSchema = z.strictObject({
  serviceArea: serviceAreaSchema,
});

export const brandStoreErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  OTHER_STORE: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type BrandStoreError = keyof typeof brandStoreErrors;
export type RegisterBrandStoreInput = z.infer<typeof registerBrandStoreSchema>;
export type RecordStoreFactUseInput = z.infer<typeof recordStoreFactUseSchema>;

export type BrandStoreView = {
  id: string;
  brandId: string;
  name: string;
  serviceArea: string;
  createdAt: string;
};

export type StoreFactUseView = {
  id: string;
  storeId: string;
  serviceArea: string;
  usedOtherStore: false;
  recordedAt: string;
};

export type BrandStoreList = {
  brands: { id: string }[];
  stores: BrandStoreView[];
  uses: StoreFactUseView[];
};
