import { shareReadResponse } from "@/features/commercial/shares-api";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => shareReadResponse(request, params.id));
}
