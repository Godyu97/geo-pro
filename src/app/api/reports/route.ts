import { reportsListResponse, reportsWriteResponse } from "@/features/reports/api";

export async function GET(request: Request) {
  return reportsListResponse(request);
}

export async function POST(request: Request) {
  return reportsWriteResponse(request);
}
