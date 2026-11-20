import { contentListResponse, contentWriteResponse } from "@/features/content/api";

export async function GET(request: Request) {
  return contentListResponse(request);
}

export async function POST(request: Request) {
  return contentWriteResponse(request);
}
