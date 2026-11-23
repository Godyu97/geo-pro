import { orderListResponse, orderWriteResponse } from "@/features/commercial/orders-api";

export function GET(request: Request) {
  return orderListResponse(request);
}

export function POST(request: Request) {
  return orderWriteResponse(request);
}
