import { evidenceWriteResponse } from "@/features/evidence/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return evidenceWriteResponse(request);
}
