import { evidenceWriteResponse } from "@/features/evidence/api";
import { evidenceOverviewResponse } from "@/features/evidence/overview-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return evidenceOverviewResponse(request, "answers");
}

export async function POST(request: Request) {
  return evidenceWriteResponse(request);
}
