import { samplingPlanBudgetResponse } from "@/features/sampling-plans/api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => samplingPlanBudgetResponse(request, id));
}
