import { formalObservationReadResponse } from "@/features/formal-retest/api";

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => formalObservationReadResponse(request, params.id));
}
