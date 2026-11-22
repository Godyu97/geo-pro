import { leadRuleWriteResponse } from "@/features/business-feedback/quality-api";

export function POST(request: Request) {
  return leadRuleWriteResponse(request);
}
