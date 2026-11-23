import { deliveryDisputeResponse } from "@/features/commercial/deliveries-api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => deliveryDisputeResponse(request, params.id));
}
