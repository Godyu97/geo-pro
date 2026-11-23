import { deliveryWriteResponse } from "@/features/commercial/deliveries-api";

export function POST(request: Request) {
  return deliveryWriteResponse(request);
}
