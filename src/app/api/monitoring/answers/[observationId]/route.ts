import { evidenceReadResponse } from "@/features/evidence/api";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ observationId: string }> },
) {
  const { observationId } = await context.params;
  return evidenceReadResponse(request, observationId);
}
