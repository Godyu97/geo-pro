import { contentBriefResponse } from "@/features/content/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ briefId: string }> },
) {
  const { briefId } = await context.params;
  return contentBriefResponse(request, briefId);
}
