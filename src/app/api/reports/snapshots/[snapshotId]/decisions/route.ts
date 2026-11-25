import { reportDecisionWriteResponse, reportDecisionsResponse } from "@/features/reports/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  return reportDecisionsResponse(request, snapshotId);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  return reportDecisionWriteResponse(request, snapshotId);
}
