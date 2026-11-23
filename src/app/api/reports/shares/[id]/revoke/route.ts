import { shareRevokeResponse } from "@/features/commercial/shares-api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => shareRevokeResponse(request, params.id));
}
