import { teamLeaveResponse } from "@/features/team-access/api";

export function POST(request: Request) {
  return teamLeaveResponse(request);
}