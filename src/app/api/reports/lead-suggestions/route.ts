import { leadSuggestionDraftResponse, leadSuggestionListResponse } from "@/features/business-feedback/suggestion-api";

export function GET(request: Request) {
  return leadSuggestionListResponse(request);
}

export function POST(request: Request) {
  return leadSuggestionDraftResponse(request);
}
