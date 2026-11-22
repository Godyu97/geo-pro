import { approvalPolicyListResponse, approvalPolicySaveResponse } from "@/features/approval-policy/api";

export function GET(request: Request) {
  return approvalPolicyListResponse(request);
}

export function POST(request: Request) {
  return approvalPolicySaveResponse(request);
}
