import { brandStoreUseResponse } from "@/features/local-presence/store-api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => brandStoreUseResponse(request, params.id));
}
