import { monitoringRunControlResponse, monitoringRunReadResponse } from "@/features/monitoring/api";

export function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  return context.params.then(({ runId }) => monitoringRunReadResponse(request, runId));
}

export function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  return context.params.then(({ runId }) => monitoringRunControlResponse(request, runId));
}
