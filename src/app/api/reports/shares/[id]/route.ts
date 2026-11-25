import { shareReadResponse } from "@/features/commercial/shares-api";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => shareReadResponse(request, params.id));
}

// Browser previews write an access record and send Origin on POST.
export const POST = GET;
