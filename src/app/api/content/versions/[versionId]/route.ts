import { contentVersionResponse } from "@/features/content/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await context.params;
  return contentVersionResponse(request, versionId);
}
