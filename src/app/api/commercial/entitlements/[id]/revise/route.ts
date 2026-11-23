import { entitlementReviseResponse } from "@/features/commercial/entitlements-api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => entitlementReviseResponse(request, params.id));
}
