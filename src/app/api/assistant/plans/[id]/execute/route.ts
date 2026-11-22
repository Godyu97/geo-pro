import { assistantPlanExecuteResponse } from "@/features/assistant/api";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => assistantPlanExecuteResponse(request, params.id));
}
