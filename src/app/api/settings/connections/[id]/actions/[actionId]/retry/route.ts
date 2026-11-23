import { connectionRetryResponse } from "@/features/external-connections/api";

export function POST(request: Request, context: { params: Promise<{ id: string; actionId: string }> }) {
  return context.params.then((params) => connectionRetryResponse(request, params.id, params.actionId));
}
