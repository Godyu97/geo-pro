import { analysisDraftResponse } from "@/features/evidence/api";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ observationId: string }> },
) {
  const { observationId } = await context.params;
  return analysisDraftResponse(request, observationId);
}
