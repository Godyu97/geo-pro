import { strategyTemplateCreateResponse, strategyTemplateListResponse } from "@/features/assistant/strategy-api";

export function GET(request: Request) {
  return strategyTemplateListResponse(request);
}

export function POST(request: Request) {
  return strategyTemplateCreateResponse(request);
}
