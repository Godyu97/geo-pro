import { localObservationListResponse, localObservationRegisterResponse } from "@/features/local-presence/api";

export function GET(request: Request) {
  return localObservationListResponse(request);
}

export function POST(request: Request) {
  return localObservationRegisterResponse(request);
}
