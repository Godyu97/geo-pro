import { crawlerVisitListResponse, crawlerVisitRegisterResponse } from "@/features/data-connections/crawler-api";

export function GET(request: Request) {
  return crawlerVisitListResponse(request);
}

export function POST(request: Request) {
  return crawlerVisitRegisterResponse(request);
}
