import { brandStoreListResponse, brandStoreRegisterResponse } from "@/features/local-presence/store-api";

export function GET(request: Request) {
  return brandStoreListResponse(request);
}

export function POST(request: Request) {
  return brandStoreRegisterResponse(request);
}
