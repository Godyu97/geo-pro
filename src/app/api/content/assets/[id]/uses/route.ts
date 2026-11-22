import { imageAssetUseResponse } from "@/features/asset-reuse/image-asset-api";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return imageAssetUseResponse(request, id);
}
