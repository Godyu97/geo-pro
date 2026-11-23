import { samplingProtocolCreateResponse, samplingProtocolListResponse } from "@/features/monitoring/protocol-api";

export function GET(request: Request) {
  return samplingProtocolListResponse(request);
}

export function POST(request: Request) {
  return samplingProtocolCreateResponse(request);
}
