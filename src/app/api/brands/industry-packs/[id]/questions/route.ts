import { industryPackQuestionResponse } from "@/features/local-presence/industry-pack-api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => industryPackQuestionResponse(request, params.id));
}
