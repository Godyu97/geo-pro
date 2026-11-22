import { samplingPlanListResponse, samplingPlanWriteResponse } from "@/features/sampling-plans/api";

export function GET(request: Request) {
  return samplingPlanListResponse(request);
}

export function POST(request: Request) {
  return samplingPlanWriteResponse(request);
}
