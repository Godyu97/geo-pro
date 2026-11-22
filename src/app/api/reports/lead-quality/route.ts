import { leadQualityReadResponse } from "@/features/business-feedback/quality-api";

export function GET(request: Request) {
  return leadQualityReadResponse(request);
}
