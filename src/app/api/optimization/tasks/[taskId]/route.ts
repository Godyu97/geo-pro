import { optimizationDetailResponse } from "@/features/optimization/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  return optimizationDetailResponse(request, taskId);
}
