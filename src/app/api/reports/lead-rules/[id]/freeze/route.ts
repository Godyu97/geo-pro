import { leadRuleFreezeResponse } from "@/features/business-feedback/quality-api";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => leadRuleFreezeResponse(request, params.id));
}
