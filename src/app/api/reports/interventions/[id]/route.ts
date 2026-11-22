import { interventionBatchReadResponse } from "@/features/formal-retest/intervention-api";

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => interventionBatchReadResponse(request, params.id));
}
