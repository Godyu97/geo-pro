import { contentPublicationResponse } from "@/features/content/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ publicationId: string }> },
) {
  const { publicationId } = await context.params;
  return contentPublicationResponse(request, publicationId);
}
