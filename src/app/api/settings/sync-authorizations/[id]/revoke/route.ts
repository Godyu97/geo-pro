import { syncAuthorizationRevokeResponse } from "@/features/data-connections/revocation-api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => syncAuthorizationRevokeResponse(request, params.id));
}
