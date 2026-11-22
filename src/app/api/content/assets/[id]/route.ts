import { imageAssetReadResponse } from "@/features/asset-reuse/image-asset-api";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return imageAssetReadResponse(request, id);
}
