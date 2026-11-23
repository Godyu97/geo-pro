import { strategyTemplateDraftResponse } from "@/features/assistant/strategy-api";

export function POST(request: Request) {
  return strategyTemplateDraftResponse(request);
}
