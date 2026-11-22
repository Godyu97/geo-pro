import { qualityAlertListResponse, qualityAlertWriteResponse } from "@/features/quality-alerts/api";

export function GET(request: Request) {
  return qualityAlertListResponse(request);
}

export function POST(request: Request) {
  return qualityAlertWriteResponse(request);
}
