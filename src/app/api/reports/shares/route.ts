import { shareWriteResponse } from "@/features/commercial/shares-api";

export function POST(request: Request) {
  return shareWriteResponse(request);
}
