import { leadObservationWriteResponse } from "@/features/business-feedback/quality-api";

export function POST(request: Request) {
  return leadObservationWriteResponse(request);
}
