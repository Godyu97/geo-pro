import { teamGrantCreateResponse, teamGrantListResponse } from "@/features/team-access/api";

export function GET(request: Request) {
  return teamGrantListResponse(request);
}

export function POST(request: Request) {
  return teamGrantCreateResponse(request);
}
