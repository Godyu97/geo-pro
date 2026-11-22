import { leadSuggestionDecideResponse } from "@/features/business-feedback/suggestion-api";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => leadSuggestionDecideResponse(request, params.id));
}
