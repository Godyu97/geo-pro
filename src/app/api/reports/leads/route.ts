import { businessLeadImportResponse, businessLeadListResponse } from "@/features/business-feedback/api";

export function GET(request: Request) {
  return businessLeadListResponse(request);
}

export function POST(request: Request) {
  return businessLeadImportResponse(request);
}
