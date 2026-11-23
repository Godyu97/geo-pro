import { dataConnectionApproveResponse } from "@/features/data-connections/api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then((params) => dataConnectionApproveResponse(request, params.id));
}
