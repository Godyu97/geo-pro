import { contentBatchResponse } from "@/features/content/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await context.params;
  return contentBatchResponse(request, batchId);
}
