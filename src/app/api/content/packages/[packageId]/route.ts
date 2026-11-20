import { contentPackageResponse } from "@/features/content/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ packageId: string }> },
) {
  const { packageId } = await context.params;
  return contentPackageResponse(request, packageId);
}
