import { connectorEventImportResponse, connectorEventListResponse } from "@/features/data-connections/event-api";

export function GET(request: Request) {
  return connectorEventListResponse(request);
}

export function POST(request: Request) {
  return connectorEventImportResponse(request);
}
