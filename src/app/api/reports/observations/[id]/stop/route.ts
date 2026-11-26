import { formalObservationStopResponse } from "@/features/formal-retest/api";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => formalObservationStopResponse(request, params.id));
}
