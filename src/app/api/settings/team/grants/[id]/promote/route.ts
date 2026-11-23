import { teamGrantPromoteResponse } from "@/features/team-access/api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => teamGrantPromoteResponse(request, params.id));
}
