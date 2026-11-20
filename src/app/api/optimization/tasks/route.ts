import { optimizationListResponse, optimizationWriteResponse } from "@/features/optimization/api";

export async function GET(request: Request) {
  return optimizationListResponse(request);
}

export async function POST(request: Request) {
  return optimizationWriteResponse(request);
}
