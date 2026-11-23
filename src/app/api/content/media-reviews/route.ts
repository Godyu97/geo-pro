import { mediaReviewListResponse, mediaReviewRecordResponse } from "@/features/local-presence/media-api";

export function GET(request: Request) {
  return mediaReviewListResponse(request);
}

export function POST(request: Request) {
  return mediaReviewRecordResponse(request);
}
