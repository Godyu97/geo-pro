import { industryPackListResponse, industryPackRegisterResponse } from "@/features/local-presence/industry-pack-api";

export function GET(request: Request) {
  return industryPackListResponse(request);
}

export function POST(request: Request) {
  return industryPackRegisterResponse(request);
}
