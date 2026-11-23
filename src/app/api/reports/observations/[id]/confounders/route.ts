import { formalConfounderCreateResponse, formalConfounderListResponse } from "@/features/formal-retest/api";

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => formalConfounderListResponse(request, params.id));
}

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return context.params.then((params) => formalConfounderCreateResponse(request, params.id));
}
