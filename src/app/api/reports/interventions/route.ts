import { interventionBatchCreateResponse } from "@/features/formal-retest/intervention-api";

export function POST(request: Request) {
  return interventionBatchCreateResponse(request);
}
