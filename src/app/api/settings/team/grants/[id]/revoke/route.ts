import { teamGrantRevokeResponse } from "@/features/team-access/api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => teamGrantRevokeResponse(request, params.id));
}
