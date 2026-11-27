import { industryPackCommandResponse } from "@/features/local-presence/industry-pack-api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return industryPackCommandResponse(request, (await context.params).id);
}
