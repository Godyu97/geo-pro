import { connectionWriteResponse } from "@/features/external-connections/api";

export function POST(request: Request) {
  return connectionWriteResponse(request);
}
