import { samplingProtocolPinResponse } from "@/features/monitoring/protocol-api";

export function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  return context.params.then(({ runId }) => samplingProtocolPinResponse(request, runId));
}
