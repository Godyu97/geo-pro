import { delegationExpireResponse } from "@/features/commercial/api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => delegationExpireResponse(request, params.id));
}
