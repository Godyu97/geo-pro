import { assistantPlanReviewResponse } from "@/features/assistant/api";

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => assistantPlanReviewResponse(request, params.id));
}

export const POST = GET;
