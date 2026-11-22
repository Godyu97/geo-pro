import { approvalDecisionResponse } from "@/features/approval-policy/api";

export function POST(request: Request) {
  return approvalDecisionResponse(request);
}
