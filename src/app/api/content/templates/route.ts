import { contentTemplateListResponse } from "@/features/asset-reuse/template-api";

export function GET(request: Request) {
  return contentTemplateListResponse(request);
}
