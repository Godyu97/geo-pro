"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { publishChannelProfile } from "./commands.ts";
import { publishChannelProfileSchema, type ChannelProfileError } from "./contracts.ts";

export type ChannelProfilePublishFeedback = ChannelProfileError | "publishUnconfirmed";

export async function publishChannelProfileAction(
  _previous: ChannelProfilePublishFeedback | null,
  formData: FormData,
): Promise<ChannelProfilePublishFeedback> {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const maxRaw = String(formData.get("maxCharacters") ?? "").trim();
  const parsed = publishChannelProfileSchema.safeParse({
    brandId,
    channelKey: String(formData.get("channelKey") ?? "").trim(),
    maxCharacters: maxRaw === "" ? null : Number(maxRaw),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return "INVALID_INPUT";
  try {
    const result = await publishChannelProfile(getConnection(), session.user.id, parsed.data);
    if ("error" in result) return result.error;
  } catch {
    console.error("channel-profile-publish-unconfirmed");
    return "publishUnconfirmed";
  }
  revalidatePath("/dashboard/content/channel-profiles");
  redirect(`/dashboard/content/channel-profiles?brandId=${parsed.data.brandId}&notice=published`);
}
