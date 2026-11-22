import { formalObservationCreateResponse, formalObservationListResponse } from "@/features/formal-retest/api";

export function GET(request: Request) {
  return formalObservationListResponse(request);
}

export function POST(request: Request) {
  return formalObservationCreateResponse(request);
}
