import { delegationWriteResponse } from "@/features/commercial/api";

export function POST(request: Request) {
  return delegationWriteResponse(request);
}
