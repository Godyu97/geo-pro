import { contentTemplateUpdateResponse } from "@/features/asset-reuse/template-api";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return contentTemplateUpdateResponse(request, id);
}
