import { monitoringRunReadResponse } from "@/features/monitoring/api";

export function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  return context.params.then(({ runId }) => monitoringRunReadResponse(request, runId));
}
