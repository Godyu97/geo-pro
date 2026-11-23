import { explorationCreateResponse, explorationListResponse } from "@/features/monitoring/exploration-api";

export function GET(request: Request) {
  return explorationListResponse(request);
}

export function POST(request: Request) {
  return explorationCreateResponse(request);
}
