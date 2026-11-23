import { formalControlCreateResponse, formalControlListResponse } from "@/features/formal-retest/api";

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => formalControlListResponse(request, params.id));
}

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => formalControlCreateResponse(request, params.id));
}
