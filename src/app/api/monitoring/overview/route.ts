import { evidenceOverviewResponse } from "@/features/evidence/overview-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return evidenceOverviewResponse(request);
}
