import { demoCreateResponse, demoListResponse } from "@/features/monitoring/demo-api";

export function GET(request: Request) {
  return demoListResponse(request);
}

export function POST(request: Request) {
  return demoCreateResponse(request);
}
