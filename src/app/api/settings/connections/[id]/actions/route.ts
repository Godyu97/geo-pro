import { connectionActionResponse } from "@/features/external-connections/api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => connectionActionResponse(request, params.id));
}
