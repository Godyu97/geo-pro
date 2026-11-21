import { sourceOriginalResponse } from "@/features/asset-reuse/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const brandId = new URL(request.url).searchParams.get("brandId") ?? "";
  return sourceOriginalResponse(request, brandId, id);
}
