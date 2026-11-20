import { reportSnapshotResponse } from "@/features/reports/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  const format = new URL(request.url).searchParams.get("format") === "html" ? "html" : "json";
  return reportSnapshotResponse(request, snapshotId, format);
}
