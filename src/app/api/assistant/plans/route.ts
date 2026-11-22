import { assistantPlanCreateResponse, assistantPlanListResponse } from "@/features/assistant/api";

export function GET(request: Request) {
  return assistantPlanListResponse(request);
}

export function POST(request: Request) {
  return assistantPlanCreateResponse(request);
}
