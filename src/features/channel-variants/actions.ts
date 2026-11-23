"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { publishChannelProfile } from "./commands.ts";
import { publishChannelProfileSchema } from "./contracts.ts";

function profilesPath(brandId: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ brandId, ...extra });
  return `/dashboard/content/channel-profiles?${params.toString()}`;
}

export async function publishChannelProfileAction(formData: FormData) {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const maxRaw = String(formData.get("maxCharacters") ?? "").trim();
  const parsed = publishChannelProfileSchema.safeParse({
    brandId,
    channelKey: String(formData.get("channelKey") ?? "").trim(),
    maxCharacters: maxRaw === "" ? null : Number(maxRaw),
    note: String(formData.get("note") ?? ""),
  });
  const safeBrand = brandIdSchema.safeParse(brandId).success;
  if (!parsed.success) {
    redirect(safeBrand ? profilesPath(brandId, { error: "INVALID_INPUT" }) : "/dashboard/content/channel-profiles?error=INVALID_INPUT");
  }
  const result = await publishChannelProfile(getConnection(), session.user.id, parsed.data);
  revalidatePath("/dashboard/content/channel-profiles");
  if ("error" in result) redirect(profilesPath(parsed.data.brandId, { error: result.error }));
  redirect(profilesPath(parsed.data.brandId, { notice: "published" }));
}
