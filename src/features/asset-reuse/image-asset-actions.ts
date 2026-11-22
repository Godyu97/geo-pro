"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { expireImageAsset, registerImageAsset, registerImageAssetUse, revokeImageAsset } from "./image-asset-commands.ts";
import {
  expireImageAssetSchema,
  registerImageAssetSchema,
  registerImageAssetUseSchema,
  revokeImageAssetSchema,
} from "./image-asset-contracts.ts";

function assetsPath(brandId: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ brandId, ...extra });
  return `/dashboard/content/assets?${params.toString()}`;
}

function invalid(brandId: string): never {
  redirect(brandIdSchema.safeParse(brandId).success ? assetsPath(brandId, { error: "INVALID_INPUT" }) : "/dashboard/content/assets?error=INVALID_INPUT");
}

function wholeNumber(formData: FormData, name: string, allowZero = false) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return undefined;
  const pattern = allowZero ? /^(?:0|[1-9]\d{0,9})$/ : /^[1-9]\d{0,9}$/;
  if (!pattern.test(raw)) return Number.NaN;
  return Number(raw);
}

export async function registerImageAssetAction(formData: FormData) {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const version = wholeNumber(formData, "version");
  const byteSize = wholeNumber(formData, "byteSize", true);
  if (Number.isNaN(version) || Number.isNaN(byteSize)) invalid(brandId);
  const parsed = registerImageAssetSchema.safeParse({
    brandId,
    fileName: String(formData.get("fileName") ?? ""),
    ...(version === undefined ? {} : { version }),
    ...(byteSize === undefined ? {} : { byteSize }),
  });
  if (!parsed.success) invalid(brandId);
  const result = await registerImageAsset(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content/assets");
  if ("error" in result) redirect(assetsPath(parsed.data.brandId, { error: result.error }));
  redirect(assetsPath(parsed.data.brandId, { notice: "registered" }));
}

export async function registerImageAssetUseAction(formData: FormData) {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = registerImageAssetUseSchema.safeParse({
    brandId,
    id: String(formData.get("id") ?? ""),
    contentVersionId: String(formData.get("contentVersionId") ?? ""),
  });
  if (!parsed.success) invalid(brandId);
  const result = await registerImageAssetUse(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content/assets");
  if ("error" in result) redirect(assetsPath(parsed.data.brandId, { error: result.error }));
  redirect(assetsPath(parsed.data.brandId, { notice: "useAdded" }));
}

export async function revokeImageAssetAction(formData: FormData) {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = revokeImageAssetSchema.safeParse({
    brandId,
    id: String(formData.get("id") ?? ""),
  });
  if (!parsed.success) invalid(brandId);
  const result = await revokeImageAsset(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content/assets");
  if ("error" in result) redirect(assetsPath(parsed.data.brandId, { error: result.error }));
  redirect(assetsPath(parsed.data.brandId, { notice: "revoked" }));
}

export async function expireImageAssetAction(formData: FormData) {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const parsed = expireImageAssetSchema.safeParse({
    brandId,
    id: String(formData.get("id") ?? ""),
  });
  if (!parsed.success) invalid(brandId);
  const result = await expireImageAsset(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content/assets");
  if ("error" in result) redirect(assetsPath(parsed.data.brandId, { error: result.error }));
  redirect(assetsPath(parsed.data.brandId, { notice: "expired" }));
}
