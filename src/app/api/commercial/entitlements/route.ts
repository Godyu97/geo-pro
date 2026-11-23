import { entitlementListResponse, entitlementWriteResponse } from "@/features/commercial/entitlements-api";

export function GET(request: Request) {
  return entitlementListResponse(request);
}

export function POST(request: Request) {
  return entitlementWriteResponse(request);
}
