import { channelVariantResponse } from "@/features/content/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ variantId: string }> },
) {
  const { variantId } = await context.params;
  return channelVariantResponse(request, variantId);
}
