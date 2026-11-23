import { samplingProtocolFreezeResponse } from "@/features/monitoring/protocol-api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => samplingProtocolFreezeResponse(request, id));
}
