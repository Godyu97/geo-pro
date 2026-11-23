import { delegationPortfolioResponse } from "@/features/commercial/api";

export function GET(request: Request) {
  return delegationPortfolioResponse(request);
}
